"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      setError("Email atau kata sandi salah, atau terlalu banyak percobaan. Coba lagi nanti.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">MEDI-BOT AGENCY v3</h1>
          <p className="text-sm text-muted-foreground">Masuk dengan akun klinik Anda.</p>
        </div>
        <label className="block text-sm font-medium">
          Email
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="block text-sm font-medium">
          Kata sandi
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Memproses..." : "Masuk"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Akun uji untuk pengembangan tercantum di README. Jangan memakai kredensial uji di produksi.
        </p>
      </form>
    </main>
  );
}
