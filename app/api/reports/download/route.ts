import { readFile } from "node:fs/promises";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getRequestId, jsonWithRequestId } from "@/lib/requestContext";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { resolveReportPath } from "@/lib/reportFiles";
import { enforceRateLimit, getClientIp } from "@/lib/requestGuard";

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  void startedAt;
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";

  if (!hasPermission(role, "report:read") || session?.user.invalid) {
    await auditApiAccess({ request, session, action: "REPORT_DOWNLOAD_DENIED", detail: `Peran ${role} mencoba mengunduh laporan.` });
    return jsonWithRequestId(requestId, { error: "Akses ditolak." }, { status: 403 });
  }

  const limited = await enforceRateLimit(`report-download:${session?.user.id ?? getClientIp(request)}`, 30, 60_000);
  if (limited) return limited;

  const type = new URL(request.url).searchParams.get("type");
  if (type !== "pdf" && type !== "excel") {
    return jsonWithRequestId(requestId, { error: "type harus pdf atau excel." }, { status: 400 });
  }

  const report = await prisma.report.findFirst({ orderBy: { createdAt: "desc" } });
  const filePath = type === "pdf" ? report?.filePathPdf : report?.filePathExcel;
  if (!filePath) {
    return jsonWithRequestId(requestId, { error: "Laporan belum dibuat." }, { status: 404 });
  }

  let safePath: string;
  try {
    safePath = resolveReportPath(filePath);
  } catch {
    return jsonWithRequestId(requestId, { error: "Path laporan tidak valid." }, { status: 400 });
  }

  try {
    const bytes = await readFile(safePath);
    await auditApiAccess({ request, session, action: "REPORT_DOWNLOAD", detail: `Laporan ${report?.id ?? "-"} format ${type.toUpperCase()} diunduh.` });
    const filename = `laporan-harian.${type === "pdf" ? "pdf" : "xlsx"}`;
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": type === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return jsonWithRequestId(requestId, { error: "File laporan tidak dapat dibaca." }, { status: 404 });
  }
}