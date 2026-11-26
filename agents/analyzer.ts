/**
 * AGENT 1 - RME ANALYZER
 * Validasi 12 field wajib RME, skor 0-100, MERAH bila < 70.
 * Error kritiss: duplikat NIK, alergi Penicillin + Amoxicillin,
 * kehamilan + obat kategori X.
 */

import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto";
import { writeAgentLog } from "@/lib/agentLog";

export const REQUIRED_FIELDS = [
  "NIK",
  "Nama",
  "TTL",
  "Alamat",
  "No HP",
  "Alergi",
  "Anamnesis",
  "Diagnosis ICD-10",
  "Tindakan ICD-9",
  "Resep",
  "Lab",
  "Radiologi",
  "Vital Sign"
] as const;

export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export interface AnalyzerResult {
  medicalRecordId: string;
  patientId: string;
  score: number;
  level: "MERAH" | "HIJAU";
  missingFields: string[];
  criticalErrors: string[];
  valid: boolean;
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export async function analyzeMedicalRecord(medicalRecordId: string): Promise<AnalyzerResult> {
  const record = await prisma.medicalRecord.findUnique({
    where: { id: medicalRecordId },
    include: {
      patient: true,
      visit: { include: { labResults: true, prescriptions: true } }
    }
  });

  if (!record) throw new Error("Rekam medis tidak ditemukan.");

  const nik = decryptField(record.patient.nikEncrypted);
  const phone = decryptField(record.patient.phoneEncrypted);
  const labCount = record.visit.labResults.length;
  const prescriptionCount = record.visit.prescriptions.length;

  const present: Record<RequiredField, boolean> = {
    NIK: hasValue(nik),
    Nama: hasValue(record.patient.name),
    TTL: hasValue(record.patient.birthDate),
    Alamat: hasValue(record.patient.address),
    "No HP": hasValue(phone),
    Alergi: hasValue(record.patient.allergies),
    Anamnesis: hasValue(record.anamnesis),
    "Diagnosis ICD-10": hasValue(record.diagnosisIcd10),
    "Tindakan ICD-9": hasValue(record.actionIcd9),
    Resep: prescriptionCount > 0,
    Lab: labCount > 0,
    Radiologi: hasValue(record.radiology),
    "Vital Sign": hasValue(record.vitalSigns)
  };

  const missingFields = REQUIRED_FIELDS.filter((field) => !present[field]);
  const score = Math.round(((REQUIRED_FIELDS.length - missingFields.length) / REQUIRED_FIELDS.length) * 100);
  const criticalErrors: string[] = [];

  const duplicate = await prisma.patient.findFirst({
    where: { nikHash: record.patient.nikHash, id: { not: record.patient.id } }
  });
  if (duplicate) criticalErrors.push("ERROR KRITIS: NIK duplikat terdeteksi pada pasien lain.");

  const allergy = (record.patient.allergies ?? "").toLowerCase();
  if (allergy.includes("penicillin") && allergy.includes("amoxicillin")) {
    criticalErrors.push("ERROR KRITIS: Alergi Penicillin + Amoxicillin pada pasien yang sama.");
  }

  const categoryX = record.visit.prescriptions.some(
    (prescription) =>
      prescription.pregnancyCategory?.toUpperCase() === "X" && record.patient.pregnancy
  );
  if (categoryX) {
    criticalErrors.push("ERROR KRITIS: Pasien hamil menerima obat kategori X.");
  }

  const level: "MERAH" | "HIJAU" =
    criticalErrors.length > 0 || score < 70 ? "MERAH" : "HIJAU";

  const result: AnalyzerResult = {
    medicalRecordId: record.id,
    patientId: record.patient.id,
    score,
    level,
    missingFields,
    criticalErrors,
    valid: level === "HIJAU"
  };

  await prisma.medicalRecord.update({
    where: { id: record.id },
    data: { completenessScore: score }
  });

  await writeAgentLog({
    agentName: "RME_ANALYZER",
    status: "SUCCESS",
    message: `Analisis RME ${record.id}: skor ${score}%, level ${level}`,
    payload: JSON.stringify(result)
  });

  return result;
}

export async function runAnalyzer(): Promise<{ analyzed: number; merah: number; results: AnalyzerResult[] }> {
  const records = await prisma.medicalRecord.findMany({ select: { id: true } });
  const results: AnalyzerResult[] = [];
  for (const record of records) {
    results.push(await analyzeMedicalRecord(record.id));
  }
  return {
    analyzed: results.length,
    merah: results.filter((result) => result.level === "MERAH").length,
    results
  };
}
