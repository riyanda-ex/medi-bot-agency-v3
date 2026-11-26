"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

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
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function generate(): Promise<void> {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/reports/generate", { method: "POST" });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(payload.error ?? "Gagal membuat laporan.");
      return;
    }
    setReport({
      id: payload.reportId,
      date: payload.date,
      newPatients: 0,
      controls: 0,
      cancelled: 0,
      urgent: 0,
      pendingClaims: 0
    });
    setMessage(`Laporan ${payload.date} dibuat. Email: ${payload.email.detail}`);
  }

  return (
    <section className="space-y-4 rounded-xl border bg-white p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={generate} disabled={loading}>
          {loading ? "Membuat..." : "Buat Laporan Harian"}
        </Button>
        <a className="rounded-md border px-4 py-2 text-sm hover:bg-muted" href="/api/reports/download?type=pdf">
          Download PDF
        </a>
        <a className="rounded-md border px-4 py-2 text-sm hover:bg-muted" href="/api/reports/download?type=excel">
          Download Excel
        </a>
      </div>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {report ? (
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <div>Pasien baru: <strong>{report.newPatients}</strong></div>
          <div>Kontrol: <strong>{report.controls}</strong></div>
          <div>Batal: <strong>{report.cancelled}</strong></div>
          <div>MERAH: <strong>{report.urgent}</strong></div>
          <div>Klaim pending: <strong>{report.pendingClaims}</strong></div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Belum ada laporan. Klik tombol untuk membuat.</p>
      )}
    </section>
  );
}
