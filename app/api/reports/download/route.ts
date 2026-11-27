import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { promises as fs } from "node:fs";
import path from "node:path";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, getClientIp } from "@/lib/requestGuard";
import { resolveReportPath } from "@/lib/reportFiles";
import { getRequestId, withRequestId } from "@/lib/requestContext";
import { logApiRequest } from "@/lib/apiLog";

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";
  const ip = getClientIp(request);
  const log = (statusCode: number, error?: string) =>
    void logApiRequest({ requestId, method: "GET", path: "/api/reports/download", statusCode, durationMs: Date.now() - startedAt, ip, userId: session?.user.id, error });

  if ((!hasPermission(role, "report:read") && !hasPermission(role, "agent:run")) || session?.user.invalid) {
    await auditApiAccess({ request, session, action: "REPORT_DOWNLOAD_DENIED", detail: `Peran ${role} mencoba mengunduh laporan.`, requestId });
    log(403, "forbidden");
    return withRequestId(NextResponse.json({ error: "Akses ditolak.", requestId }, { status: 403 }), requestId);
  }
  const limited = await enforceRateLimit(`report-download:${session?.user.id ?? ip}`, 30, 60_000);
  if (limited) { log(429, "rate_limited"); return withRequestId(limited, requestId); }

  const { searchParams } = new URL(request.url);
  const reportId = searchParams.get("reportId");
  const formatParam = searchParams.get("format") ?? searchParams.get("type");
  const format = formatParam === "excel" || formatParam === "xlsx" ? "excel" : formatParam === "pdf" ? "pdf" : null;
  if (!format) {
    log(400, "invalid_query");
    return withRequestId(NextResponse.json({ error: "Parameter format/type (pdf/excel) wajib diisi.", requestId }, { status: 400 }), requestId);
  }

  const report = reportId
    ? await prisma.report.findUnique({ where: { id: reportId } })
    : await prisma.report.findFirst({ orderBy: { createdAt: "desc" } });
  if (!report) { log(404, "not_found"); return withRequestId(NextResponse.json({ error: "Laporan tidak ditemukan.", requestId }, { status: 404 }), requestId); }

  const filePath = format === "pdf" ? report.filePathPdf : report.filePathExcel;
  if (!filePath) { log(404, "file_missing"); return withRequestId(NextResponse.json({ error: "File laporan belum tersedia.", requestId }, { status: 404 }), requestId); }

  let safePath: string;
  try { safePath = resolveReportPath(filePath); } catch {
    log(400, "invalid_path"); return withRequestId(NextResponse.json({ error: "Path laporan tidak valid.", requestId }, { status: 400 }), requestId);
  }

  try {
    const buffer = await fs.readFile(safePath);
    const filename = path.basename(safePath);
    const contentType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    await auditApiAccess({ request, session, action: "REPORT_DOWNLOAD", detail: `Laporan ${reportId} format ${format}.`, requestId });
    log(200);
    return withRequestId(new NextResponse(buffer, {
      headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" }
    }), requestId);
  } catch {
    log(404, "disk_missing");
    return withRequestId(NextResponse.json({ error: "File laporan tidak ditemukan di disk.", requestId }, { status: 404 }), requestId);
  }
}
