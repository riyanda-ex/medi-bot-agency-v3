/**
 * AGENT 5 - URGENT TRIAGE + AUTO CALLER (prioritas utama).
 *
 * Timeline sesuai spesifikasi:
 *   detik 0   deteksi MERAH
 *   detik 5   tandai MERAH di dashboard + alarm
 *   detik 10  WhatsApp
 *   menit 2   telepon ke-1
 *   menit 5   telepon ke-2
 *   menit 15  eskalasi ke Perawat Jaga + Dokter Jaga + Admin
 *
 * Mode sync menjalankan tahap secara fast-forward untuk simulasi. Mode redis
 * menjadwalkan tiap tahap dengan delay sesuai URGENT_SCHEDULE.
 * Pesan keluar TIDAK PERNAH memuat diagnosis lengkap.
 */

import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto";
import { evaluateTriage, type TriageInput } from "@/lib/triageRules";
import { sendWhatsApp, isOutboundAllowed, type OutboundResult } from "@/lib/whatsapp";
import { callPatient } from "@/lib/phone";
import { writeAgentLog } from "@/lib/agentLog";
import { buildUrgentJobId, enqueueJob, isQueueEnabled } from "@/lib/queue";
import { verifyApproval, type ApprovalVerification } from "@/lib/approval";
import { requireHumanApproval } from "@/lib/env";
import { buildUrgentDedupeKey } from "@/agents/urgentDedupe";

export const WHATSAPP_TEMPLATE =
  "Halo Bapak/Ibu [NAMA], ini dari [NAMA KLINIK]. Hasil pemeriksaan Anda perlu ditindaklanjuti SEGERA hari ini. Mohon datang ke klinik atau hubungi nomor darurat [NO DARURAT]. Mohon jangan tunda. - Pesan otomatis MEDI-BOT";

export const SPOKEN_MESSAGE =
  "Halo, ini pesan otomatis dari klinik. Hasil pemeriksaan Anda perlu ditindaklanjuti segera hari ini. Silakan datang ke klinik atau hubungi nomor darurat. Terima kasih.";

export interface MessageParams {
  nama: string;
  namaKlinik: string;
  nomorDarurat: string;
}

export function buildWhatsappMessage(params: MessageParams): string {
  return WHATSAPP_TEMPLATE.replaceAll("[NAMA]", params.nama)
    .replaceAll("[NAMA KLINIK]", params.namaKlinik)
    .replaceAll("[NO DARURAT]", params.nomorDarurat);
}

export const URGENT_SCHEDULE = [
  { label: "Deteksi MERAH", offsetSeconds: 0, channel: "DETECTION" },
  { label: "Tandai MERAH + alarm", offsetSeconds: 5, channel: "ALERT" },
  { label: "Kirim WhatsApp", offsetSeconds: 10, channel: "WHATSAPP" },
  { label: "Telepon ke-1", offsetSeconds: 120, channel: "CALL" },
  { label: "Telepon ke-2", offsetSeconds: 300, channel: "CALL" },
  { label: "Eskalasi perawat/dokter/admin", offsetSeconds: 900, channel: "ESCALATION" }
] as const;

export interface StageResult {
  label: string;
  offsetSeconds: number;
  channel: string;
  status: string;
  detail: string;
  callLogId?: string;
}

export interface TriageRunResult {
  level: "MERAH" | "HIJAU" | "KUNING";
  reasons: string[];
  triageLogId: string;
  dedupeKey: string;
  needsReview: boolean;
  stages: StageResult[];
}

interface RunOptions {
  patientId: string;
  visitId?: string;
  triageLogId?: string;
  source?: string;
  actorId?: string;
  approvalId?: string;
  approvedBy?: string;
  dedupeKey?: string;
}

function jobContext(options: {
  actorId?: string;
  approvalId?: string;
  simulate?: boolean;
  stageOffset?: number;
}): Record<string, unknown> {
  return {
    actor: options.actorId ?? "SYSTEM",
    approval: options.approvalId ?? "-",
    simulate: options.simulate === true,
    stage: options.stageOffset ?? 0
  };
}

/** Untuk mode redis: tiap tahap mendapat job sendiri dengan delay sesuai SOP. */
async function scheduleFollowUpJobs(options: RunOptions): Promise<StageResult[]> {
  const scheduled: StageResult[] = [];
  const stages = URGENT_SCHEDULE.filter(
    (stage) =>
      stage.channel === "WHATSAPP" || stage.channel === "CALL" || stage.channel === "ESCALATION"
  );

  // jobId deterministik memakai kunci window, bukan triageLog.id yang selalu
  // berubah tiap triage. Ini menutup race dua cron yang sama-sama mengantri.
  const dedupeKey = options.dedupeKey ?? buildUrgentDedupeKey(options.patientId, "MERAH");
  for (const stage of stages) {
    const stageOffset = stage.offsetSeconds;
    const queued = await enqueueJob(
      "urgent.followup",
      {
        patientId: options.patientId,
        visitId: options.visitId,
        triageLogId: options.triageLogId,
        actorId: options.actorId,
        approvalId: options.approvalId,
        approvedBy: options.approvedBy,
        stageOffset,
        dedupeKey
      },
      {
        delayMs: stageOffset * 1000,
        jobId: buildUrgentJobId("urgent", dedupeKey, jobContext({ ...options, stageOffset }))
      }
    );
    scheduled.push({
      label: `${stage.label} (terjadwal T+${stageOffset}s)`,
      offsetSeconds: stageOffset,
      channel: "QUEUE",
      status: "QUEUED",
      detail: queued.detail
    });
  }
  return scheduled;
}

/**
 * Jalankan triage untuk satu kunjungan. Jika MERAH, tindak lanjut dijadwalkan
 * di antrean (redis) atau dijalankan fast-forward (sync).
 */
export async function runUrgentTriage(options: RunOptions): Promise<TriageRunResult> {
  const startedAt = Date.now();
  const visit = await prisma.visit.findFirst({
    where: {
      patientId: options.patientId,
      ...(options.visitId ? { id: options.visitId } : {})
    },
    orderBy: { visitDate: "desc" },
    include: { medicalRecords: { orderBy: { createdAt: "desc" }, take: 1 } }
  });

  if (!visit) {
    throw new Error("Kunjungan tidak ditemukan untuk pasien ini.");
  }

  const anamnesis = visit.medicalRecords[0]?.anamnesis ?? "";
  const input: TriageInput = {
    systolic: visit.vitalSystolic,
    diastolic: visit.vitalDiastolic,
    glucose: visit.glucose,
    saturation: visit.saturation,
    pulse: visit.pulse,
    temperature: visit.temperature,
    potassium: visit.potassium,
    hemoglobin: visit.hemoglobin,
    platelets: visit.platelets,
    notes: [visit.complaint, anamnesis].filter(Boolean).join(" | "),
    daysSinceControl: visit.daysSinceControl,
    chronicMedicationDaysLeft: visit.chronicMedicationDaysLeft,
    mildLabAbnormal: visit.mildLabAbnormal
  };

  const evaluation = evaluateTriage(input);
  const dedupeKey = options.dedupeKey ?? buildUrgentDedupeKey(options.patientId, evaluation.level);
  const triageLog = await prisma.triageLog.create({
    data: {
      patientId: options.patientId,
      visitId: visit.id,
      level: evaluation.level,
      reasons: JSON.stringify(evaluation.reasons),
      score: evaluation.score,
      dataComplete: evaluation.dataComplete,
      source: options.source ?? "URGENT_CALLER"
    }
  });

  await prisma.visit.update({
    where: { id: visit.id },
    data: { triageLevel: evaluation.level }
  });

  // Log hanya ringkasan tanpa angka vital atau teks klinis.
  await writeAgentLog({
    agentName: "URGENT_CALLER",
    status: "SUCCESS",
    message: `Triage ${evaluation.level} untuk pasien ${options.patientId}`,
    payload: JSON.stringify({
      level: evaluation.level,
      reasonsCount: evaluation.reasons.length,
      dataComplete: evaluation.dataComplete,
      triageLogId: triageLog.id,
      dedupeKey
    }),
    durationMs: Date.now() - startedAt,
    runId: triageLog.id
  });

  const stages: StageResult[] = [
    {
      label: "Deteksi MERAH",
      offsetSeconds: 0,
      channel: "DETECTION",
      status: "DONE",
      detail: `${evaluation.reasons.length} alasan aturan terekam (nilai vital tidak ditulis ke log).`
    },
    {
      label: "Tandai MERAH + alarm",
      offsetSeconds: 5,
      channel: "ALERT",
      status: evaluation.level === "MERAH" ? "DONE" : "SKIPPED",
      detail:
        evaluation.level === "MERAH"
          ? "Status MERAH tersimpan, alarm siap di dashboard."
          : "Tidak diperlukan."
    }
  ];

  if (evaluation.level === "MERAH") {
    const followUpOptions: RunOptions = {
      patientId: options.patientId,
      visitId: visit.id,
      triageLogId: triageLog.id,
      actorId: options.actorId,
      approvalId: options.approvalId,
      approvedBy: options.approvedBy,
      dedupeKey
    };
    if (isQueueEnabled()) {
      stages.push(...(await scheduleFollowUpJobs(followUpOptions)));
    } else {
      stages.push(...(await executeUrgentFollowUp(followUpOptions)));
    }
  }

  return {
    level: evaluation.level,
    reasons: evaluation.reasons,
    triageLogId: triageLog.id,
    dedupeKey,
    needsReview: evaluation.needsReview,
    stages
  };
}

export interface FollowUpOptions {
  patientId: string;
  visitId?: string;
  triageLogId?: string;
  actorId?: string;
  approvalId?: string;
  approvedBy?: string;
  simulate?: boolean;
  stageOffset?: number;
  dedupeKey?: string;
}

interface StageDefinition {
  label: string;
  offsetSeconds: number;
  channel: string;
  status: string;
  detail: string;
  send: "WHATSAPP" | "CALL" | null;
}

const FOLLOWUP_STAGES: StageDefinition[] = [
  {
    label: "Kirim WhatsApp",
    offsetSeconds: 10,
    channel: "WHATSAPP",
    status: "PLANNED",
    detail: "Pesan berisi ajakan datang/hubungi nomor darurat (tanpa diagnosis).",
    send: "WHATSAPP"
  },
  {
    label: "Telepon ke-1",
    offsetSeconds: 120,
    channel: "CALL",
    status: "PLANNED",
    detail: "Panggilan otomatis pertama (T+2 menit).",
    send: "CALL"
  },
  {
    label: "Telepon ke-2",
    offsetSeconds: 300,
    channel: "CALL",
    status: "PLANNED",
    detail: "Panggilan otomatis kedua (T+5 menit) bila belum diangkat.",
    send: "CALL"
  },
  {
    label: "Eskalasi perawat/dokter/admin",
    offsetSeconds: 900,
    channel: "ESCALATION",
    status: "PLANNED",
    detail: "Eskalasi ke Perawat Jaga + Dokter Jaga + Admin (T+15 menit).",
    send: null
  }
];

/**
 * Eksekusi satu tahap atau seluruh tahap. Pengiriman nyata hanya berjalan
 * bila outbound diizinkan DAN approval tervalidasi terhadap resource yang sama.
 */
export async function executeUrgentFollowUp(options: FollowUpOptions): Promise<StageResult[]> {
  const patient = await prisma.patient.findUnique({ where: { id: options.patientId } });
  if (!patient) throw new Error("Pasien tidak ditemukan.");

  let approval: ApprovalVerification = {
    ok: false,
    reason: "Simulasi tidak memerlukan approval.",
    channels: []
  };
  if (options.simulate !== true && isOutboundAllowed()) {
    approval = await verifyApproval(options.approvalId, "URGENT", options.triageLogId ?? "");
  }
  const mayRunReal =
    options.simulate !== true && isOutboundAllowed() && approval.ok && requireHumanApproval();

  const phone = decryptField(patient.phoneEncrypted);
  const message = buildWhatsappMessage({
    nama: patient.name,
    namaKlinik: process.env.CLINIC_NAME ?? "Klinik",
    nomorDarurat: process.env.EMERGENCY_NUMBER ?? "119"
  });
  const stages: StageResult[] = [];
  const definitions =
    options.stageOffset === undefined
      ? FOLLOWUP_STAGES
      : FOLLOWUP_STAGES.filter((stage) => stage.offsetSeconds === options.stageOffset);

  for (const stage of definitions) {
    let status = stage.status;
    let detail = stage.detail;
    if (stage.send === "WHATSAPP" && mayRunReal) {
      const result: OutboundResult = await sendWhatsApp(phone, message);
      status = result.ok ? "SENT" : "FAILED";
      detail = `${detail} | ${result.detail}`;
    } else if (stage.send === "CALL" && mayRunReal) {
      const result: OutboundResult = await callPatient(phone, SPOKEN_MESSAGE);
      status = result.ok ? "SENT" : "FAILED";
      detail = `${detail} | ${result.detail}`;
    } else if (stage.channel === "ESCALATION") {
      status = mayRunReal ? "ESCALATED" : "SIMULATED";
      detail = `${detail}${mayRunReal ? "" : " | Mode simulasi."}`;
    } else {
      status = "SIMULATED";
      detail = `${detail} | Mode simulasi${approval.ok ? "" : `: ${approval.reason}`}.`;
    }

    const call = await prisma.urgentCall.create({
      data: {
        patientId: options.patientId,
        visitId: options.visitId,
        triageLogId: options.triageLogId,
        channel: stage.channel === "ESCALATION" ? "ESCALATION" : stage.channel,
        attempt: stage.offsetSeconds === 300 ? 2 : 1,
        status,
        provider:
          stage.channel === "WHATSAPP"
            ? "whatsapp"
            : stage.channel === "CALL"
              ? "phone"
              : "internal",
        simulated: !mayRunReal,
        message: stage.channel === "WHATSAPP" ? message : stage.detail,
        triggeredBy: options.actorId ?? "SYSTEM",
        approvedBy: options.approvalId ?? options.approvedBy ?? null
      }
    });

    stages.push({ ...stage, status, detail, callLogId: call.id });
  }

  await writeAgentLog({
    agentName: "URGENT_CALLER",
    status: "SUCCESS",
    message: `Follow-up MERAH untuk pasien ${options.patientId}: ${stages.length} tahap`,
    payload: JSON.stringify({
      dedupeKey: options.dedupeKey ?? buildUrgentDedupeKey(options.patientId, "MERAH"),
      triageLogId: options.triageLogId ?? null,
      stages: stages.map(({ label, status }) => ({ label, status }))
    })
  });

  return stages;
}
