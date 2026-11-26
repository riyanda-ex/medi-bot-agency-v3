/**
 * Panggilan otomatis: provider twilio atau mock.
 * Ganti provider cukup dengan PHONE_PROVIDER di .env.
 * Teks yang diucapkan TIDAK pernah memuat diagnosis pasien.
 */

import { isOutboundAllowed, normalizePhone, type OutboundResult } from "@/lib/whatsapp";

export type PhoneProviderName = "twilio" | "mock";

export function resolvePhoneProvider(): PhoneProviderName {
  return (process.env.PHONE_PROVIDER ?? "mock").toLowerCase() === "twilio" ? "twilio" : "mock";
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    const map: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;"
    };
    return map[char];
  });
}

export async function callPatient(to: string, spokenMessage: string): Promise<OutboundResult> {
  const provider = resolvePhoneProvider();
  const target = normalizePhone(to);

  if (provider === "mock" || !isOutboundAllowed()) {
    return {
      ok: provider === "mock",
      simulated: true,
      provider: provider === "mock" ? "mock" : provider,
      reference: `mock-call-${Date.now()}`,
      detail:
        provider === "mock"
          ? `Panggilan mock ke ${target} tidak diproses telepon nyata.`
          : "Diblokir: ALLOW_REAL_OUTBOUND=false."
    };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from || token.includes("GANTI_")) {
    return {
      ok: false,
      simulated: true,
      provider,
      detail: "Kredensial Twilio belum lengkap di .env."
    };
  }

  try {
    const twiml = `<Response><Say language="id-ID">${escapeXml(spokenMessage)}</Say></Response>`;
    const body = new URLSearchParams({ To: target, From: from, Twiml: twiml });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body,
        signal: AbortSignal.timeout(10_000)
      }
    );
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false,
        simulated: true,
        provider,
        detail: `Twilio gagal (${response.status}): ${JSON.stringify(payload)}`
      };
    }
    return {
      ok: true,
      simulated: false,
      provider,
      reference: String(payload.sid ?? ""),
      detail: "Panggilan diajukan via Twilio."
    };
  } catch (error) {
    return {
      ok: false,
      simulated: true,
      provider,
      detail: `Kesalahan jaringan: ${(error as Error).message}`
    };
  }
}
