"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

interface MfaState {
  mfaEnabled: boolean;
  recoveryCodesRemaining: number;
}

interface MfaSetup {
  secret: string;
  otpAuthUri: string;
  recoveryCodes: string[];
}

export default function SecurityPage() {
  const [state, setState] = useState<MfaState | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/me/mfa")
      .then(async (response) => {
        if (!response.ok) return;
        const initial = (await response.json()) as MfaState;
        if (active) setState(initial);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function begin(): Promise<void> {
    setLoading(true);
    const response = await fetch("/api/me/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "BEGIN" })
    });
    const body = (await response.json()) as MfaSetup & { error?: string };
    setSetup(response.ok ? body : null);
    setMessage(
      response.ok
        ? "Simpan kode pemulihan di tempat aman, lalu masukkan kode TOTP."
        : (body.error ?? "Gagal.")
    );
    setLoading(false);
  }

  async function enable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!setup) return;
    setLoading(true);
    const response = await fetch("/api/me/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ENABLE", code })
    });
    const body = (await response.json()) as { error?: string };
    setMessage(
      response.ok
        ? "MFA aktif. Semua sesi lama dicabut; silakan login ulang."
        : (body.error ?? "Gagal.")
    );
    setLoading(false);
    if (response.ok) {
      setSetup(null);
      setState({ mfaEnabled: true, recoveryCodesRemaining: 0 });
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/me/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "DISABLE", code: disableCode })
    });
    const body = (await response.json()) as { error?: string };
    setMessage(response.ok ? "MFA dinonaktifkan. Silakan login ulang." : (body.error ?? "Gagal."));
    setLoading(false);
    if (response.ok) setState({ mfaEnabled: false, recoveryCodesRemaining: 0 });
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Keamanan akun</h1>
      <section className="rounded-lg border bg-white p-4 text-sm">
        <p>Status MFA: {state?.mfaEnabled ? "AKTIF" : "NONAKTIF"}</p>
        <p>Sisa kode pemulihan: {state?.recoveryCodesRemaining ?? 0}</p>
        {message ? <p className="mt-2 text-emerald-700">{message}</p> : null}
      </section>

      {!state?.mfaEnabled ? (
        <section className="space-y-3 rounded-lg border bg-white p-4 text-sm">
          <Button type="button" onClick={() => void begin()} disabled={loading}>
            Mulai pasang MFA
          </Button>
          {setup ? (
            <>
              <p className="break-all">
                Secret: <strong>{setup.secret}</strong>
              </p>
              <p className="break-all">
                Tautan authenticator:{" "}
                <a className="underline" href={setup.otpAuthUri}>
                  {setup.otpAuthUri}
                </a>
              </p>
              <p>Kode pemulihan (simpan sekarang, hanya tampil sekali):</p>
              <ul className="grid grid-cols-2 gap-1 font-mono">
                {setup.recoveryCodes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <form onSubmit={enable} className="space-y-2">
                <label className="block">
                  Kode 6 digit dari aplikasi authenticator
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    inputMode="numeric"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    maxLength={6}
                    required
                  />
                </label>
                <Button type="submit" disabled={loading}>
                  Aktifkan MFA
                </Button>
              </form>
            </>
          ) : null}
        </section>
      ) : (
        <form onSubmit={disable} className="space-y-2 rounded-lg border bg-white p-4 text-sm">
          <label className="block">
            Nonaktifkan MFA (kode TOTP atau kode pemulihan)
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={disableCode}
              onChange={(event) => setDisableCode(event.target.value)}
              required
            />
          </label>
          <Button type="submit" variant="outline" disabled={loading}>
            Nonaktifkan
          </Button>
        </form>
      )}
      <a className="block text-sm underline" href="/dashboard">
        Kembali ke dashboard
      </a>
    </main>
  );
}
