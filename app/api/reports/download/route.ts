import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { resolveReportPath } from "@/lib/reportFiles";
import { withRequestId } from "@/lib/requestContext";
import { logApiRequest } from "@/lib/apiLog";
import { deny, guardRateLimit, withApi } from "@/lib/apiRoute";

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await withApi(request, { path: "/api/reports/download", skipOrigin: true });
  if (gate.response) return gate.response;
  const { ctx } = gate;

  if ((!hasPermission(ctx.role, "report:read") && !hasPermission(ctx.role, "agent:run")) || ctx.sessionInvalid) {
    return deny(ctx, 403, "Akses ditolak.", "REPORT_DOWNLOAD_DENIED", `Peran ${ctx.role} mencoba mengunduh laporan.`);
  }
  const limited = await guardRateLimit(ctx, `report-download:${ctx.userId ?? ctx.ip}`, 30, 60_000);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const reportId = searchParams.get("reportId");
  const formatParam = searchParams.get("format") ?? searchParams.get("type");
  const format = formatParam === "excel" || formatParam === "xlsx" ? "excel" : formatParam === "pdf" ? "pdf" : null;
  if (!format) {
    void logApiRequest({ requestId: ctx.requestId, method: "GET", path: ctx.path, statusCode: 400, durationMs: Date.now() - ctx.startedAt, ip: ctx.ip, userId: ctx.userId, error: "invalid_query" });
    return withRequestId(NextResponse.json({ error: "Parameter format/type (pdf/excel) wajib diisi.", requestId: ctx.requestId }, { status: 400 }), ctx.requestId);
  }

  const report = reportId
    ? await prisma.report.findUnique({ where: { id: reportId } })
    : await prisma.report.findFirst({ orderBy: { createdAt: "desc" } });
  if (!report) {
    void logApiRequest({ requestId: ctx.requestId, method: "GET", path: ctx.path, statusCode: 404, durationMs: Date.now() - ctx.startedAt, ip: ctx.ip, userId: ctx.userId, error: "not_found" });
    return withRequestId(NextResponse.json({ error: "Laporan tidak ditemukan.", requestId: ctx.requestId }, { status: 404 }), ctx.requestId);
  }

  const filePath = format === "pdf" ? report.filePathPdf : report.filePathExcel;
  if (!filePath) {
    void logApiRequest({ requestId: ctx.requestId, method: "GET", path: ctx.path, statusCode: 404, durationMs: Date.now() - ctx.startedAt, ip: ctx.ip, userId: ctx.userId, error: "file_missing" });
    return withRequestId(NextResponse.json({ error: "File laporan belum tersedia.", requestId: ctx.requestId }, { status: 404 }), ctx.requestId);
  }

  let safePath: string;
  try { safePath = resolveReportPath(filePath); } catch {
    void logApiRequest({ requestId: ctx.requestId, method: "GET", path: ctx.path, statusCode: 400, durationMs: Date.now() - ctx.startedAt, ip: ctx.ip, userId: ctx.userId, error: "invalid_path" });
    return withRequestId(NextResponse.json({ error: "Path laporan tidak valid.", requestId: ctx.requestId }, { status: 400 }), ctx.requestId);
  }

  try {
    const buffer = await fs.readFile(safePath);
    const filename = path.basename(safePath);
    const contentType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    await auditApiAccess({ request: ctx.request, session: ctx.session, action: "REPORT_DOWNLOAD", detail: `Laporan ${reportId} format ${format}.`, requestId: ctx.requestId });
    void logApiRequest({ requestId: ctx.requestId, method: "GET", path: ctx.path, statusCode: 200, durationMs: Date.now() - ctx.startedAt, ip: ctx.ip, userId: ctx.userId });
    return withRequestId(new NextResponse(buffer, {
      headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" }
    }), ctx.requestId);
  } catch {
    void logApiRequest({ requestId: ctx.requestId, method: "GET", path: ctx.path, statusCode: 404, durationMs: Date.now() - ctx.startedAt, ip: ctx.ip, userId: ctx.userId, error: "disk_missing" });
    return withRequestId(NextResponse.json({ error: "File laporan tidak ditemukan di disk.", requestId: ctx.requestId }, { status: 404 }), ctx.requestId);
  }
}
