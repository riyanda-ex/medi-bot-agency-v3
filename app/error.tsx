"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error("UI_ERROR", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">Terjadi kesalahan</h2>
        <p className="mt-2 text-sm text-slate-600">
          Sistem mengalami gangguan saat memproses permintaan. Silakan coba lagi. Jika berlanjut,
          hubungi administrator.
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-slate-500">Referensi: {error.digest}</p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <Button onClick={reset}>Coba lagi</Button>
          <Button variant="outline" onClick={() => router.push("/dashboard")}>
            Ke Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
