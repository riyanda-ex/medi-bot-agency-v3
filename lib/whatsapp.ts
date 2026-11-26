/**
 * Pengirim WhatsApp dengan tiga provider: fonnte, wablas, mock.
 * Ganti provider cukup dengan WHATSAPP_PROVIDER di .env.
 * Default = mock. Pengiriman nyata diblokir kecuali ALLOW_REAL_OUTBOUND=true.
 */

export type WhatsAppProviderName = "fonnte" | "wablas" | "mock";

export interface OutboundResult {
  ok: boolean;
  simulated: boolean;
  provider: string;
  reference?: string;
  detail: string;
}

export function resolveWhatsAppProvider(): WhatsAppProviderName {
  const raw = (process.env.WHATSAPP_PROVIDER ?? "mock").toLowerCase();
  if (raw === "fonnte" || raw === "wablas") return raw;
  return "mock";
}

export function isOutboundAllowed(): boolean {
  return process.env.ALLOW_REAL_OUTBOUND === "true";
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function blocked(provider: string, detail: string): OutboundResult {
  return { ok: false, simulated: true, provider, detail };
}

export async function sendWhatsApp(to: string, message: string): Promise<OutboundResult> {
  const provider = resolveWhatsAppProvider();
  const target = normalizePhone(to);

  if (provider === "mock") {
    return {
      ok: true,
      simulated: true,
      provider: "mock",
      reference: `mock-wa-${Date.now()}`,
      detail: `Pesan mock ke ${target} tidak dikirim ke jaringan.`
    };
  }

  if (!isOutboundAllowed()) {
    return blocked(
      provider,
      "Diblokir: ALLOW_REAL_OUTBOUND=false. Aktifkan hanya setelah approval klinis & legal."
    );
  }

  try {
    if (provider === "fonnte") {
      const token = process.env.FONNTE_TOKEN;
      if (!token || token.includes("GANTI_")) {
        return blocked(provider, "FONNTE_TOKEN belum diisi di .env.");
      }
      const response = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ target, message })
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        return blocked(provider, `Fonnte gagal (${response.status}): ${JSON.stringify(body)}`);
      }
      return {
        ok: true,
        simulated: false,
        provider,
        reference: String(body.id ?? ""),
        detail: "Pesan terkirim via Fonnte."
      };
    }

    const token = process.env.WABLAS_TOKEN;
    if (!token || token.includes("GANTI_")) {
      return blocked(provider, "WABLAS_TOKEN belum diisi di .env.");
    }
    const domain = process.env.WABLAS_DOMAIN ?? "https://console.wablas.com";
    const response = await fetch(`${domain}/api/send-message`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: target, message })
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return blocked(provider, `Wablas gagal (${response.status}): ${JSON.stringify(body)}`);
    }
    const data = body.data as { id?: string } | undefined;
    return {
      ok: true,
      simulated: false,
      provider,
      reference: String(data?.id ?? ""),
      detail: "Pesan terkirim via Wablas."
    };
  } catch (error) {
    return blocked(provider, `Kesalahan jaringan: ${(error as Error).message}`);
  }
}
