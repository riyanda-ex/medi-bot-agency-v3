/**
 * AGENT 4 - AUTO REPORTER
 * Laporan harian 07:30: pasien baru, kontrol, batal, urgent, top 10 diagnosa,
 * dokter tersibuk, stok obat <10, klaim BPJS pending, grafik kunjungan 7 hari.
 * Export PDF + Excel dan kirim email (mock by default).
 */

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { writeAgentLog } from "@/lib/agentLog";
import { verifyApproval } from "@/lib/approval";
import { publicReportName } from "@/lib/reportFiles";

export interface DailyReportData {
  date: string;
  newPatients: number;
  controls: number;
  cancelled: number;
  urgent: number;
  topDiagnoses: Array<{ code: string; total: number }>;
  busiestDoctors: Array<{ doctorId: string; total: number }>;
  lowStock: Array<{ name: string; stock: number; unit: string }>;
  pendingClaims: number;
  visits7Days: Array<{ date: string; total: number }>;
  generatedAt: string;
}

function wibRange(date: Date): { start: Date; end: Date } {
  const wibNow = new Date(date.getTime() + 7 * 3_600_000);
  const year = wibNow.getUTCFullYear();
  const month = wibNow.getUTCMonth();
  const day = wibNow.getUTCDate();
  return {
    start: new Date(Date.UTC(year, month, day, -7)),
    end: new Date(Date.UTC(year, month, day + 1, -7))
  };
}

export async function buildDailyReport(date: Date = new Date()): Promise<DailyReportData> {
  const { start, end } = wibRange(date);

  const [
    newPatients,
    controls,
    cancelled,
    urgent,
    groupedDiagnoses,
    groupedDoctors,
    lowStockRows,
    pendingClaims
  ] = await Promise.all([
    prisma.patient.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.visit.count({ where: { visitDate: { gte: start, lt: end }, status: "COMPLETED" } }),
    prisma.visit.count({ where: { visitDate: { gte: start, lt: end }, status: "CANCELLED" } }),
    prisma.triageLog.count({ where: { level: "MERAH", createdAt: { gte: start, lt: end } } }),
    prisma.visit.groupBy({
      by: ["icd10"],
      where: { visitDate: { gte: start, lt: end }, icd10: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { icd10: "desc" } },
      take: 10
    }),
    prisma.visit.groupBy({
      by: ["doctorId"],
      where: { visitDate: { gte: start, lt: end }, doctorId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { doctorId: "desc" } },
      take: 10
    }),
    prisma.medicineStock.findMany({ where: { stock: { lt: 10 } }, orderBy: { stock: "asc" } }),
    prisma.claim.count({ where: { status: "PENDING" } })
  ]);

  const visits7Days: Array<{ date: string; total: number }> = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(start.getTime() - offset * 86_400_000);
    const next = new Date(day.getTime() + 86_400_000);
    visits7Days.push({
      date: day.toISOString().slice(0, 10),
      total: await prisma.visit.count({ where: { visitDate: { gte: day, lt: next } } })
    });
  }

  return {
    date: start.toISOString().slice(0, 10),
    newPatients,
    controls,
    cancelled,
    urgent,
    topDiagnoses: groupedDiagnoses.map((item) => ({
      code: item.icd10 ?? "-",
      total: (item._count as { _all: number })._all
    })),
    busiestDoctors: groupedDoctors.map((item) => ({
      doctorId: item.doctorId ?? "-",
      total: (item._count as { _all: number })._all
    })),
    lowStock: lowStockRows.map((item) => ({ name: item.name, stock: item.stock, unit: item.unit })),
    pendingClaims,
    visits7Days,
    generatedAt: new Date().toISOString()
  };
}

export async function generateReportPdf(data: DailyReportData, filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(18).text("LAPORAN HARIAN MEDI-BOT AGENCY v3");
    doc.fontSize(11).text(`Tanggal: ${data.date}`);
    doc.moveDown();
    doc.text(`Pasien baru: ${data.newPatients}`);
    doc.text(`Kunjungan kontrol: ${data.controls}`);
    doc.text(`Kunjungan batal: ${data.cancelled}`);
    doc.text(`Pasien MERAH: ${data.urgent}`);
    doc.text(`Klaim BPJS pending: ${data.pendingClaims}`);
    doc.moveDown();
    doc.text("Diagnosa Top 10:");
    for (const item of data.topDiagnoses) doc.text(`  ${item.code}: ${item.total}`);
    doc.moveDown();
    doc.text("Dokter tersibuk:");
    for (const item of data.busiestDoctors) doc.text(`  ${item.doctorId}: ${item.total} kunjungan`);
    doc.moveDown();
    doc.text("Stok obat < 10:");
    for (const item of data.lowStock) doc.text(`  ${item.name}: ${item.stock} ${item.unit}`);
    doc.moveDown();
    doc.text("Grafik kunjungan 7 hari:");
    for (const item of data.visits7Days) doc.text(`  ${item.date}: ${item.total}`);
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

export async function generateReportExcel(data: DailyReportData, filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MEDI-BOT AGENCY v3";

  const summary = workbook.addWorksheet("Ringkasan");
  summary.columns = [
    { header: "Metrik", key: "metric", width: 28 },
    { header: "Nilai", key: "value", width: 16 }
  ];
  summary.addRows([
    { metric: "Tanggal", value: data.date },
    { metric: "Pasien baru", value: data.newPatients },
    { metric: "Kontrol", value: data.controls },
    { metric: "Batal", value: data.cancelled },
    { metric: "MERAH", value: data.urgent },
    { metric: "Klaim BPJS pending", value: data.pendingClaims }
  ]);

  const diagnoses = workbook.addWorksheet("Diagnosa Top 10");
  diagnoses.columns = [
    { header: "ICD-10", key: "code", width: 18 },
    { header: "Jumlah", key: "total", width: 12 }
  ];
  diagnoses.addRows(data.topDiagnoses);

  const stock = workbook.addWorksheet("Stok Menipis");
  stock.columns = [
    { header: "Obat", key: "name", width: 30 },
    { header: "Stok", key: "stock", width: 12 },
    { header: "Satuan", key: "unit", width: 12 }
  ];
  stock.addRows(data.lowStock);

  const chart = workbook.addWorksheet("Kunjungan 7 Hari");
  chart.columns = [
    { header: "Tanggal", key: "date", width: 16 },
    { header: "Kunjungan", key: "total", width: 14 }
  ];
  chart.addRows(data.visits7Days);

  // ExcelJS 4.4 tidak memiliki API addChart. Data bar conditional formatting
  // memberikan visualisasi batang nyata di dalam sel tanpa library tambahan.
  // Typing packaged tidak memuat `color` pada DataBarRuleType, tetapi xform XLSX
  // merendernya; tipe lokal dipakai agar tidak mengubah dependency.
  type FormattedRule = Parameters<typeof chart.addConditionalFormatting>[0]["rules"][number];
  const dataBarRule = {
    type: "dataBar",
    cfvo: [{ type: "min" }, { type: "max" }],
    color: { rgb: "FF10B981" }
  } as unknown as FormattedRule;
  chart.addConditionalFormatting({ ref: "B2:B8", rules: [dataBarRule] });

  await workbook.xlsx.writeFile(filePath);
}

export async function sendReportEmail(
  attachments: string[],
  recipient: string,
  resourceId: string,
  approvalId?: string
): Promise<{ sent: boolean; simulated: boolean; detail: string }> {
  const outboundRequested =
    process.env.ALLOW_REAL_OUTBOUND === "true" &&
    Boolean(process.env.SMTP_HOST) &&
    process.env.SYNC_MODE !== "true";

  let approvalOk = false;
  let approvalReason = "Email mock: pengiriman nyata tidak diminta.";
  if (outboundRequested) {
    const approval = await verifyApproval(approvalId, "REPORT", resourceId);
    approvalOk = approval.ok;
    approvalReason = approval.reason;
  }

  if (!outboundRequested || !approvalOk) {
    return {
      sent: false,
      simulated: true,
      detail: `Email mock ke ${recipient}. ${approvalReason}`
    };
  }

  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? "medi-bot@klinik.example",
      to: recipient,
      subject: `Laporan harian MEDI-BOT AGENCY v3`,
      text: "Terlampir laporan harian klinik.",
      attachments: attachments.map((filePath) => ({
        filename: path.basename(filePath),
        path: filePath
      }))
    });
    return { sent: true, simulated: false, detail: `Email terkirim ke ${recipient}.` };
  } catch (error) {
    return {
      sent: false,
      simulated: false,
      detail: `Gagal kirim email: ${(error as Error).message}`
    };
  }
}

export interface ReporterRunResult {
  reportId: string;
  data: DailyReportData;
  files: { pdf: string; excel: string };
  email: { sent: boolean; simulated: boolean; detail: string };
}

export async function runReporter(
  date: Date = new Date(),
  approvalId?: string
): Promise<ReporterRunResult> {
  const startedAt = Date.now();
  const data = await buildDailyReport(date);
  const dir = path.join(process.cwd(), "reports", data.date);
  const pdfPath = path.join(dir, "laporan-harian.pdf");
  const excelPath = path.join(dir, "laporan-harian.xlsx");

  await Promise.all([generateReportPdf(data, pdfPath), generateReportExcel(data, excelPath)]);

  const recipient = process.env.ALERT_EMAIL ?? "pimpinan@klinik.example";
  const email = await sendReportEmail([pdfPath, excelPath], recipient, data.date, approvalId);

  const report = await prisma.report.create({
    data: {
      reportDate: new Date(),
      type: "DAILY",
      filePathPdf: pdfPath,
      filePathExcel: excelPath,
      payload: JSON.stringify(data),
      recipients: recipient,
      status: email.sent || email.simulated ? "GENERATED" : "FAILED"
    }
  });

  await writeAgentLog({
    agentName: "AUTO_REPORTER",
    status: "SUCCESS",
    message: `Laporan ${data.date} dibuat (PDF + Excel), email simulasi=${email.simulated}`,
    durationMs: Date.now() - startedAt,
    runId: report.id
  });

  // Jangan mengembalikan path absolut server ke klien.
  return {
    reportId: report.id,
    data,
    files: { pdf: publicReportName(pdfPath), excel: publicReportName(excelPath) },
    email
  };
}
