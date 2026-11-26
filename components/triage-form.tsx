"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { triageBadgeClass, type TriageLevel } from "@/lib/triageRules";

interface PatientOption {
  id: string;
  name: string;
  nikMasked: string;
}

interface TriageResponse {
  level: TriageLevel;
  reasons: string[];
  triageLogId: string;
  needsReview: boolean;
  latencyMs: number;
  visitId: string;
  patientName: string;
}

interface SimulateStage {
  label: string;
  offsetSeconds: number;
  status: string;
  detail: string;
  callLogId?: string;
}

const fields = [
  { key: "systolic", label: "TD Sistolik (mmHg)", placeholder: "190" },
  { key: "diastolic", label: "TD Diastolik (mmHg)", placeholder: "120" },
  { key: "glucose", label: "Gula darah (mg/dL)", placeholder: "320" },
  { key: "saturation", label: "Saturasi O2 (%)", placeholder: "88" },
  { key: "pulse", label: "Nadi (x/menit)", placeholder: "125" },
  { key: "temperature", label: "Suhu (°C)", placeholder: "39.5" },
  { key: "potassium", label: "Kalium (mmol/L)", placeholder: "6.1" },
  { key: "hemoglobin", label: "Hemoglobin (g/dL)", placeholder: "6.9" },
  { key: "platelets", label: "Trombosit (/µL)", placeholder: "49000" }
] as const;

type FieldKey = (typeof fields)[number]["key"];
type FormValues = Record<FieldKey, string>;

const emptyValues = Object.fromEntries(fields.map((field) => [field.key, ""])) as FormValues;

export function TriageForm({ patients }: { patients: PatientOption[] }) {
  const [patientId, setPatientId] = useState(patients[0]?.id ?? "");
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [result, setResult] = useState<TriageResponse | null>(null);
  const [stages, setStages] = useState<SimulateStage[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function setValue(key: FieldKey, value: string): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function buildVitals(): Record<string, number | null> {
    const output: Record<string, number | null> = {};
    for (const field of fields) {
      const raw = values[field.key].trim();
      output[field.key] = raw === "" ? null : Number(raw);
    }
    return output;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    setStages([]);

    const response = await fetch("/api/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        complaint: "Input dari halaman triage",
        vitals: buildVitals()
      })
    });
    const payload = (await response.json()) as TriageResponse & { error?: string };
    setLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "Gagal melakukan triage.");
      return;
    }
    setResult(payload);
  }

  async function handleSimulate(): Promise<void> {
    if (!result) return;
    setError("");
    const response = await fetch("/api/urgent/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        visitId: result.visitId,
        triageLogId: result.triageLogId
      })
    });
    const payload = (await response.json()) as { stages?: SimulateStage[]; error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Simulasi gagal.");
      return;
    }
    setStages(payload.stages ?? []);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Triage Pasien</h1>
        <p className="text-sm text-muted-foreground">
          Hasil MERAH muncul segera setelah submit. Semua pesan keluar bersifat simulasi.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border bg-white p-6">
        <label className="block text-sm font-medium">
          Pasien
          <select
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            value={patientId}
            onChange={(event) => setPatientId(event.target.value)}
          >
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.name} — {patient.nikMasked}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          {fields.map((field) => (
            <label key={field.key} className="block text-sm font-medium">
              {field.label}
              <input
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                type="number"
                step="any"
                placeholder={field.placeholder}
                value={values[field.key]}
                onChange={(event) => setValue(field.key, event.target.value)}
              />
            </label>
          ))}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" disabled={loading || !patientId}>
          {loading ? "Memproses..." : "Jalankan Triage"}
        </Button>
      </form>

      {result ? (
        <section className="space-y-4 rounded-xl border bg-white p-6">
          <div className="flex items-center gap-3">
            <span className={`rounded px-3 py-1 font-bold ${triageBadgeClass(result.level)}`}>
              {result.level}
            </span>
            <span className="text-sm text-muted-foreground">
              {result.patientName} — diproses dalam {result.latencyMs} ms
            </span>
          </div>
          <ul className="list-inside list-disc text-sm">
            {result.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {result.needsReview ? (
            <p className="text-sm text-amber-700">
              Perlu tinjauan tenaga klinis (data tidak lengkap atau status MERAH).
            </p>
          ) : null}

          {result.level === "MERAH" ? (
            <div className="space-y-3 border-t pt-4">
              <p className="font-medium">Tindak lanjut urgent</p>
              <Button variant="destructive" onClick={handleSimulate}>
                Simulasi Panggilan Urgent
              </Button>
              {stages.length > 0 ? (
                <ol className="space-y-2 text-sm">
                  {stages.map((stage) => (
                    <li key={`${stage.label}-${stage.offsetSeconds}`} className="rounded border p-3">
                      <span className="font-semibold">T+{stage.offsetSeconds} detik — {stage.label}</span>
                      <span className="ml-2">{stage.status}</span>
                      <p className="text-muted-foreground">{stage.detail}</p>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
