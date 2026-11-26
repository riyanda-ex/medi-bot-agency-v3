/**
 * AGENT 7 - PATIENT ENGAGEMENT
 * Pengingat obat 08:00 & 20:00, kontrol H-3/H-1, chatbot terbatas,
 * batal -> bebaskan slot & waiting list, prediksi no-show.
 */

import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto";
import { writeAgentLog } from "@/lib/agentLog";

const EDUCATION_KEYWORDS = ["obat", "kontrol", "antrian", "dokter", "jadwal", "edukasi"];
const FALLBACK_REPLY =
  "Untuk pertanyaan medis detail, silakan hubungi klinik.";

export function chatbotReply(message: string): string {
  const text = message.toLowerCase();
  if (!EDUCATION_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return FALLBACK_REPLY;
  }
  if (text.includes("antrian")) {
    return "Nomor antrian dapat dilihat di resepsionis atau dashboard klinik.";
  }
  if (text.includes("jadwal") || text.includes("dokter")) {
    return "Jadwal dokter tersedia di menu appointment. Pilih dokter lalu lihat slot yang tersedia.";
  }
  if (text.includes("obat")) {
    return "Minum obat sesuai anjuran dokter. Pengingat dikirim pukul 08:00 dan 20:00 WIB.";
  }
  if (text.includes("kontrol")) {
    return "Pengingat kontrol dikirim 3 hari dan 1 hari sebelum jadwal. Mohon konfirmasi kehadiran.";
  }
  return "Edukasi singkat: jaga pola makan, istirahat cukup, dan lanjutkan kontrol rutin. " + FALLBACK_REPLY;
}

function wibTime(day: Date, hour: number, minute = 0): Date {
  const copy = new Date(day);
  copy.setUTCHours(hour - 7, minute, 0, 0);
  return copy;
}

export async function scheduleMedicationReminders(day: Date = new Date()): Promise<number> {
  const patients = await prisma.patient.findMany({ select: { id: true }, take: 100 });
  let created = 0;

  for (const patient of patients) {
    for (const hour of [8, 20]) {
      const scheduledAt = wibTime(day, hour);
      const existing = await prisma.notification.findFirst({
        where: {
          patientId: patient.id,
          template: `OBAT_${hour}`,
          scheduledAt: { gte: wibTime(day, 0), lt: wibTime(day, 23, 59) }
        }
      });
      if (existing) continue;
      await prisma.notification.create({
        data: {
          patientId: patient.id,
          channel: "WHATSAPP",
          template: `OBAT_${hour}`,
          payload: `Pengingat minum obat pukul ${String(hour).padStart(2, "0")}:00 WIB.`,
          status: "SCHEDULED",
          scheduledAt
        }
      });
      created += 1;
    }
  }
  return created;
}

export async function scheduleControlReminders(now: Date = new Date()): Promise<number> {
  const appointments = await prisma.appointment.findMany({
    where: { status: { in: ["BOOKED", "CONFIRMED"] } },
    take: 100
  });
  let created = 0;

  for (const appointment of appointments) {
    const daysLeft = Math.round((appointment.scheduledAt.getTime() - now.getTime()) / 86_400_000);
    const templates = daysLeft === 3 && !appointment.reminderH3 ? ["KONTROL_H3"] : [];
    if (daysLeft === 1 && !appointment.reminderH1) templates.push("KONTROL_H1");

    for (const template of templates) {
      await prisma.notification.create({
        data: {
          patientId: appointment.patientId,
          channel: "WHATSAPP",
          template,
          payload: `Pengingat kontrol ${template === "KONTROL_H3" ? "3 hari" : "1 hari"} lagi.`,
          status: "SCHEDULED",
          scheduledAt: now
        }
      });
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: template === "KONTROL_H3" ? { reminderH3: true } : { reminderH1: true }
      });
      created += 1;
    }
  }
  return created;
}

export async function handleCancellation(appointmentId: string): Promise<{
  appointmentId: string;
  waitingListId: string;
  offeredTo: string;
}> {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw new Error("Appointment tidak ditemukan.");

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "CANCELLED" }
  });

  const candidate = await prisma.waitingList.findFirst({
    where: { status: "WAITING", doctorId: appointment.doctorId },
    orderBy: { createdAt: "asc" }
  });

  const waiting = candidate
    ? await prisma.waitingList.update({
        where: { id: candidate.id },
        data: { status: "OFFERED" }
      })
    : await prisma.waitingList.create({
        data: {
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          status: "OFFERED",
          preferredAt: appointment.scheduledAt
        }
      });

  await prisma.notification.create({
    data: {
      patientId: waiting.patientId,
      channel: "WHATSAPP",
      template: "SLOT_OFFER",
      payload: "Slot baru tersedia karena ada pembatalan. Silakan konfirmasi ke klinik.",
      status: "SCHEDULED",
      scheduledAt: new Date()
    }
  });

  return {
    appointmentId,
    waitingListId: waiting.id,
    offeredTo: waiting.patientId
  };
}

export function calculateNoShowRisk(input: {
  cancellations: number;
  distanceKm: number;
  age: number;
}): number {
  let risk = 0;
  if (input.cancellations >= 2) risk += 40;
  if (input.distanceKm > 20) risk += 20;
  if (input.age > 60) risk += 10;
  return risk;
}

export async function predictNoShow(appointmentId: string): Promise<{
  appointmentId: string;
  risk: number;
  extraReminder: boolean;
}> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { patient: true }
  });
  if (!appointment) throw new Error("Appointment tidak ditemukan.");

  const cancellations = await prisma.appointment.count({
    where: { patientId: appointment.patientId, status: "CANCELLED" }
  });
  const age = Math.floor(
    (Date.now() - appointment.patient.birthDate.getTime()) / (365.25 * 86_400_000)
  );
  const risk = calculateNoShowRisk({
    cancellations,
    distanceKm: appointment.patient.distanceKm,
    age
  });

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { noShowRisk: risk }
  });

  let extraReminder = false;
  if (risk > 60) {
    await prisma.notification.create({
      data: {
        patientId: appointment.patientId,
        channel: "WHATSAPP",
        template: "NOSHOW_EXTRA",
        payload: "Mohon konfirmasi kehadiran Anda. Slot klinik menunggu konfirmasi.",
        status: "SCHEDULED",
        scheduledAt: new Date()
      }
    });
    extraReminder = true;
  }

  return { appointmentId, risk, extraReminder };
}

export async function runEngagement(): Promise<{
  medicationReminders: number;
  controlReminders: number;
  highRiskAppointments: number;
}> {
  const [medicationReminders, controlReminders] = await Promise.all([
    scheduleMedicationReminders(),
    scheduleControlReminders()
  ]);

  const appointments = await prisma.appointment.findMany({ select: { id: true } });
  const predictions = [];
  for (const appointment of appointments) {
    predictions.push(await predictNoShow(appointment.id));
  }

  const result = {
    medicationReminders,
    controlReminders,
    highRiskAppointments: predictions.filter((item) => item.risk > 60).length
  };

  await writeAgentLog({
    agentName: "PATIENT_ENGAGEMENT",
    status: "SUCCESS",
    message: `Pengingat dibuat: ${JSON.stringify(result)}`
  });

  return result;
}

export function decryptPatientPhone(phoneEncrypted: string): string {
  return decryptField(phoneEncrypted);
}
