"use client";

import { useState, type FormEvent } from "react";
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
  const [result, setResult] = useState<ApprovalResponse | null>(null);
  const [loading, setLoading] = useState(false);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    const response = await fetch("/api/urgent/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, resourceId, channels })
    });
    setResult((await response.json()) as ApprovalResponse);
    setLoading(false);
  }

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-semibold">Approval pengiriman nyata</h2>
      <p className="mt-1 text-sm text-amber-800">
        Berikan approval hanya untuk tindakan yang Anda setujui. Berlaku 30 menit dan tercatat di
        audit.
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
            Triage log
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
            <label key={channel} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={channels.includes(channel)}
                onChange={() => toggleChannel(channel)}
              />
              {channel}
            </label>
          ))}
        </fieldset>

        <Button type="submit" disabled={loading || !resourceId || channels.length === 0}>
          {loading ? "Menyimpan..." : "Berikan Approval"}
        </Button>
      </form>

      {result?.approvalId ? (
        <p className="mt-3 break-all rounded bg-white p-3 text-xs">
          Approval ID: <strong>{result.approvalId}</strong>
          <br />
          Berlaku sampai: {result.expiresAt}
          <br />
          Masukkan ID ini pada form triage atau generate laporan bila pengiriman nyata diaktifkan.
        </p>
      ) : null}
      {result?.error ? <p className="mt-3 text-sm text-red-700">{result.error}</p> : null}
    </section>
  );
}
