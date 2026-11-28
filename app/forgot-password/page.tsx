"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    setMessage(
      response.ok
        ? "Permintaan diterima. Bila akun terdaftar, tautan reset dikirim ke email."
        : "Permintaan gagal. Coba lagi nanti."
    );
    setLoading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-semibold">Atur ulang kata sandi</h1>
        <p className="text-sm text-muted-foreground">
          Masukkan email akun klinik. Tautan berlaku 1 jam dan sekali pakai.
        </p>
        <label className="block text-sm font-medium">
          Email
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Mengirim..." : "Kirim tautan"}
        </Button>
        <a className="block text-center text-xs underline" href="/login">
          Kembali ke login
        </a>
      </form>
    </main>
  );
}
