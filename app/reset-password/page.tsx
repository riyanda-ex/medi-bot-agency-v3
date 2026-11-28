"use client";

import { use, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

type SearchParams = Promise<{ token?: string | string[] }>;

export default function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const query = use(searchParams);
  const rawToken = Array.isArray(query.token) ? query.token[0] : query.token;
  const token = typeof rawToken === "string" ? rawToken : "";
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password })
    });
    setMessage(
      response.ok
        ? "Kata sandi berhasil diubah. Semua sesi lama dicabut; silakan login lagi."
        : "Tautan tidak sah/kedaluwarsa atau kata sandi kurang dari 12 karakter."
    );
    setLoading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-semibold">Kata sandi baru</h1>
        <p className="text-sm text-muted-foreground">Minimal 12 karakter.</p>
        <label className="block text-sm font-medium">
          Kata sandi baru
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        {message ? <p className="text-sm">{message}</p> : null}
        <Button type="submit" className="w-full" disabled={loading || !token}>
          {loading ? "Menyimpan..." : "Simpan kata sandi"}
        </Button>
        <a className="block text-center text-xs underline" href="/login">
          Kembali ke login
        </a>
      </form>
    </main>
  );
}
