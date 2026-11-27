import { NextResponse } from "next/server";
import { z } from "zod";
import { auditApiAccess } from "@/lib/audit";
import { chatbotReply } from "@/agents/engagement";
import { createApiContext, deny, guardOrigin, guardRateLimit, ok } from "@/lib/apiRoute";

const bodySchema = z.object({
  message: z.string().min(1).max(500)
});

/** Chatbot edukasi terbatas: butuh sesi, rate limited, tidak menjawab diagnosis personal. */
export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/chatbot");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;

  if (!ctx.session?.user?.id || ctx.sessionInvalid) {
    return deny(ctx, 401, "Autentikasi diperlukan.", "CHATBOT_DENIED", "Akses tanpa sesi.");
  }

  const limited = await guardRateLimit(
    ctx,
    `chatbot:${ctx.session.user.id}:${ctx.ip}`,
    20,
    60_000
  );
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return deny(
      ctx,
      400,
      "Pesan tidak valid (maksimal 500 karakter).",
      "CHATBOT_INVALID",
      "Payload chatbot tidak valid."
    );
  }

  const reply = chatbotReply(parsed.data.message);
  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "CHATBOT_REPLY",
    detail: "Balasan edukasi generik diberikan (isi pesan tidak disimpan).",
    requestId: ctx.requestId
  });

  return ok(ctx, { reply, requestId: ctx.requestId });
}
