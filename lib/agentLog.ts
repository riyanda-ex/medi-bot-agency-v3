import { prisma } from "@/lib/prisma";

export interface AgentLogInput {
  agentName: string;
  status: string;
  message?: string;
  payload?: string;
  durationMs?: number;
  runId?: string;
}

/** Logging agent tidak boleh menggagalkan proses utama. */
export async function writeAgentLog(input: AgentLogInput): Promise<void> {
  try {
    await prisma.agentLog.create({
      data: {
        agentName: input.agentName,
        status: input.status,
        message: input.message,
        payload: input.payload,
        durationMs: input.durationMs,
        runId: input.runId
      }
    });
  } catch (error) {
    console.error("[AGENT_LOG] Gagal menulis log:", (error as Error).message);
  }
}
