/**
 * Aturan triage MediBot Clinical Operations Platform.
 * Murni deterministik dan tanpa dependency Prisma supaya bisa diuji cepat.
 * Ambang berasal dari spesifikasi sistem, BUKAN pedoman klinis resmi.
 * Validasi klinis wajib sebelum pemakaian nyata.
 */

export type TriageLevel = "MERAH" | "KUNING" | "HIJAU";

export const RED_KEYWORDS = [
  "perdarahan",
  "sesak berat",
  "tidak sadar",
  "kejang",
  "nyeri dada hebat"
] as const;

export interface TriageInput {
  systolic?: number | null;
  diastolic?: number | null;
  glucose?: number | null;
  saturation?: number | null;
  pulse?: number | null;
  temperature?: number | null;
  potassium?: number | null;
  hemoglobin?: number | null;
  platelets?: number | null;
  notes?: string | null;
  daysSinceControl?: number | null;
  chronicMedicationDaysLeft?: number | null;
  mildLabAbnormal?: boolean | null;
}

type NumericField =
  | "systolic"
  | "diastolic"
  | "glucose"
  | "saturation"
  | "pulse"
  | "temperature"
  | "potassium"
  | "hemoglobin"
  | "platelets";

interface FieldLabel {
  key: NumericField;
  label: string;
}

const CORE_FIELDS: readonly FieldLabel[] = [
  { key: "systolic", label: "Tekanan darah sistolik" },
  { key: "diastolic", label: "Tekanan darah diastolik" },
  { key: "glucose", label: "Gula darah" },
  { key: "saturation", label: "Saturasi oksigen" },
  { key: "pulse", label: "Nadi" },
  { key: "temperature", label: "Suhu tubuh" },
  { key: "potassium", label: "Kalium" },
  { key: "hemoglobin", label: "Hemoglobin" },
  { key: "platelets", label: "Trombosit" }
];

export interface TriageEvaluation {
  level: TriageLevel;
  reasons: string[];
  missingFields: string[];
  dataComplete: boolean;
  needsReview: boolean;
  score: number;
  evaluatedAt: string;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Evaluasi satu set vital sign. Mengembalikan level, alasan, dan kualitas data. */
export function evaluateTriage(input: TriageInput, now: Date = new Date()): TriageEvaluation {
  const redReasons: string[] = [];
  const yellowReasons: string[] = [];

  if (isNumber(input.systolic) && input.systolic >= 180) {
    redReasons.push(`TD sistolik ${input.systolic} mmHg (≥ 180)`);
  }
  if (isNumber(input.diastolic) && input.diastolic >= 110) {
    redReasons.push(`TD diastolik ${input.diastolic} mmHg (≥ 110)`);
  }
  if (isNumber(input.glucose) && input.glucose >= 300) {
    redReasons.push(`Gula darah ${input.glucose} mg/dL (≥ 300)`);
  }
  if (isNumber(input.glucose) && input.glucose <= 50) {
    redReasons.push(`Gula darah ${input.glucose} mg/dL (≤ 50)`);
  }
  if (isNumber(input.saturation) && input.saturation < 90) {
    redReasons.push(`Saturasi ${input.saturation}% (< 90)`);
  }
  if (isNumber(input.pulse) && input.pulse > 120) {
    redReasons.push(`Nadi ${input.pulse} x/menit (> 120)`);
  }
  if (isNumber(input.pulse) && input.pulse < 40) {
    redReasons.push(`Nadi ${input.pulse} x/menit (< 40)`);
  }
  if (isNumber(input.temperature) && input.temperature >= 39.5) {
    redReasons.push(`Suhu ${input.temperature}°C (≥ 39.5)`);
  }
  if (isNumber(input.potassium) && input.potassium > 6.0) {
    redReasons.push(`Kalium ${input.potassium} mmol/L (> 6.0)`);
  }
  if (isNumber(input.hemoglobin) && input.hemoglobin < 7) {
    redReasons.push(`Hemoglobin ${input.hemoglobin} g/dL (< 7)`);
  }
  if (isNumber(input.platelets) && input.platelets < 50_000) {
    redReasons.push(`Trombosit ${input.platelets}/µL (< 50.000)`);
  }

  const notes = (input.notes ?? "").toLocaleLowerCase("id-ID");
  for (const keyword of RED_KEYWORDS) {
    if (notes.includes(keyword)) {
      redReasons.push(`Keyword MERAH pada anamnesis: "${keyword}"`);
    }
  }

  if (isNumber(input.daysSinceControl) && input.daysSinceControl > 7) {
    yellowReasons.push(`Kontrol terlewat ${input.daysSinceControl} hari (> 7)`);
  }
  if (
    isNumber(input.chronicMedicationDaysLeft) &&
    input.chronicMedicationDaysLeft >= 0 &&
    input.chronicMedicationDaysLeft <= 3
  ) {
    yellowReasons.push(`Obat kronis tersisa ${input.chronicMedicationDaysLeft} hari`);
  }
  if (input.mildLabAbnormal === true) {
    yellowReasons.push("Hasil lab abnormal ringan");
  }

  const missingFields = CORE_FIELDS.filter((field) => !isNumber(input[field.key])).map(
    (field) => field.label
  );
  const dataComplete = missingFields.length === 0;
  const score = Math.round(
    ((CORE_FIELDS.length - missingFields.length) / CORE_FIELDS.length) * 100
  );

  const level: TriageLevel =
    redReasons.length > 0 ? "MERAH" : yellowReasons.length > 0 ? "KUNING" : "HIJAU";

  return {
    level,
    reasons: [...redReasons, ...yellowReasons],
    missingFields,
    dataComplete,
    needsReview: level === "MERAH" || !dataComplete,
    score,
    evaluatedAt: now.toISOString()
  };
}

export function isEmergency(level: TriageLevel): boolean {
  return level === "MERAH";
}

export function triageBadgeClass(level: TriageLevel): string {
  if (level === "MERAH") return "bg-red-600 text-white";
  if (level === "KUNING") return "bg-amber-400 text-amber-950";
  return "bg-emerald-600 text-white";
}
