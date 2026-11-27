"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Visit7Day {
  date: string;
  total: number;
}

interface ReportSummary {
  id: string;
  date: string;
  newPatients: number;
  controls: number;
  cancelled: number;
  urgent: number;
  pendingClaims: number;
}

export function ReportPanel({ initial }: { initial: ReportSummary | null }) {
  const [report, setReport] = useState<ReportSummary | null>(initial);
  const [visits7Days, setVisits7Days] = useState<Visit7Day[]>([]);
  const [approvalId, setApprovalId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function generate(): Promise<void> {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: approvalId.trim() || undefined })
    });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(payload.error ?? "Gagal membuat laporan.");
      return;
    }
    setReport({
      id: payload.reportId,
      date: payload.date,
      newPatients: payload.summary.newPatients,
      controls: payload.summary.controls,
      cancelled: payload.summary.cancelled,
      urgent: payload.summary.urgent,
      pendingClaims: payload.summary.pendingClaims
    });
    setVisits7Days(payload.summary.visits7Days ?? []);
    setMessage(`Laporan ${payload.date} dibuat. Email: ${payload.email.detail}`);
  }

  const maxVisits = Math.max(1, ...visits7Days.map((item) => item.total));

  return (
    <section className="space-y-4 rounded-xl border bg-white p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={generate} disabled={loading}>
          {loading ? "Membuat..." : "Buat Laporan Harian"}
        </Button>
        <a
          className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          href="/api/reports/download?type=pdf"
        >
          Download PDF
        </a>
        <a
          className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          href="/api/reports/download?type=excel"
        >
          Download Excel
        </a>
      </div>
      <label className="block max-w-md text-sm font-medium">
        Approval ID email (opsional, untuk pengiriman nyata)
        <input
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          type="text"
          value={approvalId}
          onChange={(event) => setApprovalId(event.target.value)}
          placeholder="Apr-... (dari panel approval)"
        />
      </label>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {report ? (
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <div>
            Pasien baru: <strong>{report.newPatients}</strong>
          </div>
          <div>
            Kontrol: <strong>{report.controls}</strong>
          </div>
          <div>
            Batal: <strong>{report.cancelled}</strong>
          </div>
          <div>
            MERAH: <strong>{report.urgent}</strong>
          </div>
          <div>
            Klaim pending: <strong>{report.pendingClaims}</strong>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Belum ada laporan. Klik tombol untuk membuat.
        </p>
      )}

      {visits7Days.length > 0 ? (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold">Kunjungan 7 hari terakhir</p>
          <div className="mt-3 flex h-32 items-end gap-2">
            {visits7Days.map((item) => (
              <div key={item.date} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-emerald-500"
                  style={{ height: `${Math.max(4, (item.total / maxVisits) * 100)}%` }}
                  title={`${item.date}: ${item.total}`}
                />
                <span className="text-[10px] text-muted-foreground">{item.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
