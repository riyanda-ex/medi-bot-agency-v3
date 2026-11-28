"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

interface PendingUrgent {
  id: string;
  patientName: string;
  level: string;
  createdAt: string;
}

interface ApprovalResponse {
  approvalId?: string;
  expiresAt?: string;
  denied?: boolean;
  error?: string;
}

/** Approval nyata untuk outbound. Hanya dirender untuk DOKTER/ADMIN. */
export function ApprovalPanel({
  pendingUrgent,
  today
}: {
  pendingUrgent: PendingUrgent[];
  today: string;
}) {
  const [scope, setScope] = useState<"URGENT" | "REPORT">("URGENT");
  const [resourceId, setResourceId] = useState(pendingUrgent[0]?.id ?? "");
  const [channels, setChannels] = useState<string[]>(["WHATSAPP", "CALL", "EMAIL", "ESCALATION"]);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ApprovalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const expiresAtMs = result?.expiresAt ? Date.parse(result.expiresAt) : NaN;
  const remainingMs = Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - now) : 0;
  const expired = Boolean(result?.approvalId) && remainingMs === 0;

  useEffect(() => {
    if (!Number.isFinite(expiresAtMs)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAtMs]);

  function changeScope(next: "URGENT" | "REPORT"): void {
    setScope(next);
    setResourceId(next === "URGENT" ? (pendingUrgent[0]?.id ?? "") : today);
    setResult(null);
  }

  function toggleChannel(channel: string): void {
    setChannels((current) =>
      current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]
    );
  }

  async function submit(decision: "GRANT" | "DENY"): Promise<void> {
    setLoading(true);
    setResult(null);
    const response = await fetch("/api/urgent/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, resourceId, channels, decision, reason: reason || undefined })
    });
    setNow(Date.now());
    setResult((await response.json()) as ApprovalResponse);
    setLoading(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit("GRANT");
  }

  const remainingLabel = `${String(Math.floor(remainingMs / 60_000)).padStart(2, "0")}:${String(
    Math.floor((remainingMs % 60_000) / 1000)
  ).padStart(2, "0")}`;

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-semibold">Approval pengiriman nyata</h2>
      <p className="mt-1 text-sm text-amber-800">
        Periksa triase MERAH lebih dulu. approval berlaku 30 menit, sekali pakai per tindakan, dan
        tercatat di audit.
      </p>
      <form onSubmit={handleSubmit} className="mt-3 space-y-3 text-sm">
        <label className="block font-medium">
          Jenis
          <select
            className="mt-1 w-full rounded-md border bg-white px-3 py-2"
            value={scope}
            onChange={(event) => changeScope(event.target.value as "URGENT" | "REPORT")}
          >
            <option value="URGENT">Tindak lanjut MERAH</option>
            <option value="REPORT">Email laporan ({today})</option>
          </select>
        </label>

        {scope === "URGENT" ? (
          <label className="block font-medium">
            Triage log (MERAH diprioritaskan)
            <select
              className="mt-1 w-full rounded-md border bg-white px-3 py-2"
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
              required
            >
              {pendingUrgent.length === 0 ? <option value="">Belum ada triage MERAH</option> : null}
              {pendingUrgent.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.patientName} — {item.level} — {item.createdAt}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="rounded border bg-white px-3 py-2">Resource: laporan tanggal {today}</p>
        )}

        <fieldset className="flex flex-wrap gap-3">
          <legend className="font-medium">Kanal yang disetujui</legend>
          {["WHATSAPP", "CALL", "EMAIL", "ESCALATION"].map((channel) => (
            <label key={channel} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={channels.includes(channel)}
                onChange={() => toggleChannel(channel)}
              />
              {channel}
            </label>
          ))}
        </fieldset>

        <label className="block font-medium">
          Alasan penolakan (wajib bila menolak)
          <input
            className="mt-1 w-full rounded-md border bg-white px-3 py-2"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            placeholder="Contoh: data pasien belum dikonfirmasi"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={loading || expired || !resourceId || channels.length === 0}
          >
            {loading ? "Menyimpan..." : "Setujui"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading || !resourceId || reason.trim().length < 5}
            onClick={() => void submit("DENY")}
          >
            Tolak
          </Button>
        </div>
      </form>

      {result?.approvalId ? (
        <p className="mt-3 break-all rounded bg-white p-3 text-xs" aria-live="polite">
          Approval ID: <strong>{result.approvalId}</strong>
          <br />
          Sisa masa berlaku: <strong>{remainingLabel}</strong> {expired ? "(kedaluwarsa)" : ""}
          <br />
          Berlaku sampai: {result.expiresAt}
          <br />
          Masukkan ID ini pada form triage atau generate laporan bila pengiriman nyata diaktifkan.
        </p>
      ) : null}
      {result?.denied ? (
        <p className="mt-3 rounded bg-white p-3 text-sm text-red-700" aria-live="polite">
          Penolakan tercatat di audit. Approval sebelumnya untuk resource ini dicabut dan tidak
          dapat dipakai lagi.
        </p>
      ) : null}
      {result?.error ? <p className="mt-3 text-sm text-red-700">{result.error}</p> : null}
    </section>
  );
}
