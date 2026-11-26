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
 * Pesan keluar TIDAK PERNAH memuat diagnosis lengkap.
 */

import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto";
import { evaluateTriage, type TriageInput } from "@/lib/triageRules";
import { sendWhatsApp, isOutboundAllowed, type OutboundResult } from "@/lib/whatsapp";
import { callPatient } from "@/lib/phone";
import { writeAgentLog } from "@/lib/agentLog";
import { enqueueJob } from "@/lib/queue";

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
  level: "MERAH" | "KUNING" | "HIJAU";
  reasons: string[];
  triageLogId: string;
  needsReview: boolean;
  stages: StageResult[];
}

interface RunOptions {
  patientId: string;
  visitId?: string;
  source?: string;
  actorId?: string;
  approvedBy?: string;
}

/**
 * Jalankan triage untuk satu kunjungan. Jika MERAH,Workflow tindak lanjut
 * langsung dicatat. Mode simulasi dipakai bila approval/outbound tidak aktif.
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

  await writeAgentLog({
    agentName: "URGENT_CALLER",
    status: "SUCCESS",
    message: `Triage ${evaluation.level} untuk pasien ${options.patientId}`,
    payload: JSON.stringify(evaluation),
    durationMs: Date.now() - startedAt,
    runId: triageLog.id
  });

  const stages: StageResult[] = [
    {
      label: "Deteksi MERAH",
      offsetSeconds: 0,
      channel: "DETECTION",
      status: "DONE",
      detail: evaluation.reasons.join("; ")
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
    const queued = await enqueueJob(
      "urgent.followup",
      {
        patientId: options.patientId,
        visitId: visit.id,
        triageLogId: triageLog.id,
        actorId: options.actorId,
        approvedBy: options.approvedBy
      },
      { jobId: `urgent-${triageLog.id}` }
    );

    if (queued.mode === "redis") {
      stages.push({
        label: "Tindak lanjut MERAH masuk antrean",
        offsetSeconds: 0,
        channel: "QUEUE",
        status: "QUEUED",
        detail: queued.detail
      });
    } else {
      const followUp = await executeUrgentFollowUp({
        patientId: options.patientId,
        visitId: visit.id,
        triageLogId: triageLog.id,
        actorId: options.actorId,
        approvedBy: options.approvedBy
      });
      stages.push(...followUp);
    }
  }

  return {
    level: evaluation.level,
    reasons: evaluation.reasons,
    triageLogId: triageLog.id,
    needsReview: evaluation.needsReview,
    stages
  };
}

interface FollowUpOptions {
  patientId: string;
  visitId?: string;
  triageLogId?: string;
  actorId?: string;
  approvedBy?: string;
  simulate?: boolean;
}

/**
 * Simulasi/eksekusi tindak lanjut MERAH. Selalu menulis urgent_calls.
 * Mode nyata hanya berjalan bila ALLOW_REAL_OUTBOUND=true DAN ada approval.
 */
export async function executeUrgentFollowUp(options: FollowUpOptions): Promise<StageResult[]> {
  const patient = await prisma.patient.findUnique({ where: { id: options.patientId } });
  if (!patient) throw new Error("Pasien tidak ditemukan.");

  const approvalRequired = process.env.REQUIRE_HUMAN_APPROVAL !== "false";
  const mayRunReal =
    options.simulate !== true &&
    isOutboundAllowed() &&
    (!approvalRequired || Boolean(options.approvedBy));

  const phone = decryptField(patient.phoneEncrypted);
  const message = buildWhatsappMessage({
    nama: patient.name,
    namaKlinik: process.env.CLINIC_NAME ?? "Klinik",
    nomorDarurat: process.env.EMERGENCY_NUMBER ?? "119"
  });

  const stages: StageResult[] = [];

  async function recordStage(
    stage: StageResult,
    send: (() => Promise<OutboundResult>) | null
  ): Promise<void> {
    let status = stage.status;
    let detail = stage.detail;
    if (send) {
      if (mayRunReal) {
        const result = await send();
        status = result.ok ? "SENT" : "FAILED";
        detail = `${detail} | ${result.detail}`;
      } else {
        status = "SIMULATED";
        detail = `${detail} | Mode simulasi: tidak ada pengiriman nyata.`;
      }
    }

    const call = await prisma.urgentCall.create({
      data: {
        patientId: options.patientId,
        visitId: options.visitId,
        triageLogId: options.triageLogId,
        channel: stage.channel === "DETECTION" || stage.channel === "ALERT" ? "ALERT" : stage.channel,
        attempt: stage.offsetSeconds === 300 ? 2 : 1,
        status,
        provider: stage.channel === "WHATSAPP" ? "whatsapp" : stage.channel === "CALL" ? "phone" : "internal",
        simulated: !mayRunReal,
        message: stage.channel === "WHATSAPP" ? message : stage.detail,
        triggeredBy: options.actorId ?? "SYSTEM",
        approvedBy: options.approvedBy ?? null
      }
    });

    stages.push({ ...stage, status, detail, callLogId: call.id });
  }

  const waResult = mayRunReal ? await sendWhatsApp(phone, message) : null;

  await recordStage(
    {
      label: "Kirim WhatsApp",
      offsetSeconds: 10,
      channel: "WHATSAPP",
      status: waResult ? (waResult.ok ? "SENT" : "FAILED") : "SIMULATED",
      detail: `Pesan berisi ajakan datang/hubungi nomor darurat (tanpa diagnosis).${
        waResult ? ` ${waResult.detail}` : " Mode simulasi."
      }`
    },
    null
  );

  await recordStage(
    {
      label: "Telepon ke-1",
      offsetSeconds: 120,
      channel: "CALL",
      status: "PLANNED",
      detail: "Panggilan otomatis pertama (T+2 menit)."
    },
    () => callPatient(phone, SPOKEN_MESSAGE)
  );

  await recordStage(
    {
      label: "Telepon ke-2",
      offsetSeconds: 300,
      channel: "CALL",
      status: "PLANNED",
      detail: "Panggilan otomatis kedua (T+5 menit) bila belum diangkat."
    },
    () => callPatient(phone, SPOKEN_MESSAGE)
  );

  await recordStage(
    {
      label: "Eskalasi perawat/dokter/admin",
      offsetSeconds: 900,
      channel: "ESCALATION",
      status: mayRunReal ? "ESCALATED" : "SIMULATED",
      detail: "Eskalasi ke Perawat Jaga + Dokter Jaga + Admin (T+15 menit)."
    },
    null
  );

  await writeAgentLog({
    agentName: "URGENT_CALLER",
    status: "SUCCESS",
    message: `Follow-up MERAH untuk pasien ${options.patientId}: ${stages.length} tahap`,
    payload: JSON.stringify(stages.map(({ label, status }) => ({ label, status })))
  });

  return stages;
}
