import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { runAllAgents } from "@/agents/orchestrator";

export async function POST(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "RESEPSIONIS";

  if (!hasPermission(role, "agent:run")) {
    return NextResponse.json({ error: "Akses ditolak: hanya ADMIN yang bisa menjalankan agent." }, { status: 403 });
  }

  const result = await runAllAgents();
  return NextResponse.json(result);
}
