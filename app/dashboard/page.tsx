import Link from "next/link";
import { auth } from "@/auth";
import { canAccessAudit, canApproveOutbound, canViewDiagnosis, canViewTriage } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ManualRunButton } from "@/components/manual-run-button";
import { ApprovalPanel } from "@/components/approval-panel";

async function distinctPatientCount(level: string): Promise<number> {
  const rows = await prisma.triageLog.findMany({
    where: { level },
    distinct: ["patientId"],
    select: { id: true }
  });
  return rows.length;
}

const LEVEL_PRIORITY: Record<string, number> = { MERAH: 0, KUNING: 1, HIJAU: 2 };

export default async function DashboardPage() {
  const session = await auth();
  const role = session?.user.role ?? "TIDAK_AKTIF";

  const [patients, redCount, yellowCount, greenCount, urgentCalls, recent, latestDiagnosis] =
    await Promise.all([
      prisma.patient.count(),
      distinctPatientCount("MERAH"),
      distinctPatientCount("KUNING"),
      distinctPatientCount("HIJAU"),
      prisma.urgentCall.count({ where: { simulated: true } }),
      prisma.triageLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { patient: { select: { name: true, nikMasked: true } } }
      }),
      canViewDiagnosis(role)
        ? prisma.visit.findFirst({
            where: { diagnosis: { not: null } },
            orderBy: { visitDate: "desc" },
            select: {
              diagnosis: true,
              icd10: true,
              patient: { select: { name: true, nikMasked: true } }
            }
          })
        : Promise.resolve(null)
    ]);

  const pendingUrgent = canApproveOutbound(role)
    ? [...recent]
        .sort((a, b) => {
          const priority = (LEVEL_PRIORITY[a.level] ?? 9) - (LEVEL_PRIORITY[b.level] ?? 9);
          return priority !== 0 ? priority : b.createdAt.getTime() - a.createdAt.getTime();
        })
        .slice(0, 8)
        .map((item) => ({
          id: item.id,
          patientName: item.patient.name,
          level: item.level,
          createdAt: item.createdAt.toLocaleString("id-ID")
        }))
    : [];

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard MediBot Clinical Operations Platform</h1>
          <p className="text-sm text-muted-foreground">
            Login sebagai {session?.user.name ?? "tamu"} — peran {role}
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link className="rounded border px-3 py-2 hover:bg-muted" href="/triage">
            Triage
          </Link>
          <Link className="rounded border px-3 py-2 hover:bg-muted" href="/reports">
            Laporan
          </Link>
          <Link className="rounded border px-3 py-2 hover:bg-muted" href="/security">
            Keamanan
          </Link>
          {canAccessAudit(role) ? (
            <Link className="rounded border px-3 py-2 hover:bg-muted" href="/audit">
              Audit
            </Link>
          ) : null}
        </nav>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className="rounded-lg border p-4">
          <p className="text-sm">Pasien</p>
          <p className="text-2xl font-bold">{patients}</p>
        </div>
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <p className="text-sm">MERAH</p>
          <p className="text-2xl font-bold text-red-700">{redCount}</p>
        </div>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm">KUNING</p>
          <p className="text-2xl font-bold text-amber-700">{yellowCount}</p>
        </div>
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm">HIJAU</p>
          <p className="text-2xl font-bold text-emerald-700">{greenCount}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm">Log urgent (mock)</p>
          <p className="text-2xl font-bold">{urgentCalls}</p>
        </div>
      </section>

      {role === "ADMIN" ? <ManualRunButton /> : null}
      {canApproveOutbound(role) ? (
        <ApprovalPanel
          pendingUrgent={pendingUrgent}
          today={new Date().toISOString().slice(0, 10)}
        />
      ) : null}

      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">Hak akses Anda</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>Lihat diagnosis: {canViewDiagnosis(role) ? "IZIN" : "DITOLAK"}</li>
          <li>Lihat triage: {canViewTriage(role) ? "IZIN" : "DITOLAK"}</li>
          <li>Audit log: {canAccessAudit(role) ? "IZIN" : "DITOLAK"}</li>
        </ul>
        {latestDiagnosis ? (
          <p className="mt-3 rounded bg-slate-50 p-3 text-sm">
            Diagnosis pasien: <strong>{latestDiagnosis.patient.name}</strong> —{" "}
            {latestDiagnosis.diagnosis} ({latestDiagnosis.icd10 ?? "-"}) — NIK{" "}
            {latestDiagnosis.patient.nikMasked}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">Triage terbaru</h2>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="pb-2">Pasien</th>
              <th>NIK</th>
              <th>Level</th>
              <th>Waktu</th>
            </tr>
          </thead>
          <tbody>
            {canViewTriage(role) ? (
              recent.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="py-2">{item.patient.name}</td>
                  <td>{item.patient.nikMasked}</td>
                  <td>{item.level}</td>
                  <td>{item.createdAt.toLocaleString("id-ID")}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-2 text-muted-foreground">
                  Data triage tidak tersedia untuk peran Anda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
