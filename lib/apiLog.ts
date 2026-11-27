import { prisma } from "@/lib/prisma";

export interface ApiLogInput {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip?: string | null;
  userId?: string | null;
  userAgent?: string | null;
  error?: string | null;
}

export async function logApiRequest(input: ApiLogInput): Promise<void> {
  try {
    await prisma.apiLog.create({
      data: {
        requestId: input.requestId,
        method: input.method.slice(0, 16),
        path: input.path.slice(0, 512),
        statusCode: input.statusCode,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        ip: input.ip?.slice(0, 64) ?? null,
        userId: input.userId ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        error: input.error?.slice(0, 1000) ?? null
      }
    });
  } catch (error) {
    console.error("[API_LOG] gagal simpan", (error as Error).message);
  }
}
