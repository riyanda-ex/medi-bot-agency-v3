import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { auditApiAccess } from "@/lib/audit";
import { chatbotReply } from "@/agents/engagement";

const bodySchema = z.object({
  message: z.string().min(1).max(500)
});

/** Chatbot edukasi terbatas: tidak menjawab diagnosis atau saran medis personal. */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pesan tidak valid (maksimal 500 karakter)." }, { status: 400 });
  }

  const reply = chatbotReply(parsed.data.message);
  await auditApiAccess({
    request,
    session,
    action: "CHATBOT_REPLY",
    detail: "Balasan edukasi generik diberikan (isi pesen tidak disimpan)."
  });

  return NextResponse.json({ reply });
}
