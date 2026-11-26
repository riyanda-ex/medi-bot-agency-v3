"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Outcome {
  name: string;
  status: string;
  attempts: number;
}

export function ManualRunButton() {
  const [loading, setLoading] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [error, setError] = useState("");

  async function run(): Promise<void> {
    setLoading(true);
    setError("");
    const response = await fetch("/api/orchestrator/run", { method: "POST" });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(payload.error ?? "Gagal menjalankan agent.");
      return;
    }
    setOutcomes(payload.outcomes ?? []);
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Manual Run Orchestrator</h2>
          <p className="text-sm text-muted-foreground">Menjalankan seluruh agent dengan retry 3x.</p>
        </div>
        <Button onClick={run} disabled={loading} variant="outline">
          {loading ? "Berjalan..." : "Jalankan Sekarang"}
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {outcomes.length > 0 ? (
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {outcomes.map((item) => (
            <li key={item.name} className="rounded border px-3 py-2">
              {item.name}: <strong>{item.status}</strong> ({item.attempts}x)
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
