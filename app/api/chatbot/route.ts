import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { auditApiAccess } from "@/lib/audit";
import { chatbotReply } from "@/agents/engagement";
import { enforceRateLimit, enforceSameOrigin, getClientIp } from "@/lib/requestGuard";

const bodySchema = z.object({
  message: z.string().min(1).max(500)
});

/** Chatbot edukasi terbatas: butuh sesi, rate limited, tidak menjawab diagnosis personal. */
export async function POST(request: Request): Promise<NextResponse> {
  const originBlocked = enforceSameOrigin(request);
  if (originBlocked) return originBlocked;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.invalid) {
    await auditApiAccess({ request, session, action: "CHATBOT_DENIED", detail: "Akses tanpa sesi." });
    return NextResponse.json({ error: "Autentikasi diperlukan." }, { status: 401 });
  }

  const limited = enforceRateLimit(`chatbot:${session.user.id}:${getClientIp(request)}`, 20, 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pesan tidak valid (maksimal 500 karakter)." }, { status: 400 });
  }

  const reply = chatbotReply(parsed.data.message);
  await auditApiAccess({
    request,
    session,
    action: "CHATBOT_REPLY",
    detail: "Balasan edukasi generik diberikan (isi pesan tidak disimpan)."
  });

  return NextResponse.json({ reply });
}