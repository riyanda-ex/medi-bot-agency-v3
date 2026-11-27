import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ReportPanel } from "@/components/report-panel";

export default async function ReportsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!hasPermission(session.user.role, "report:read")) {
    return <main className="p-8"><h1 className="text-2xl font-semibold">Akses ditolak</h1></main>;
  }

  const latest = await prisma.report.findFirst({ orderBy: { createdAt: "desc" } });
  let initial = null;
  if (latest?.payload) {
    const payload = JSON.parse(latest.payload) as {
      date: string;
      newPatients: number;
      controls: number;
      cancelled: number;
      urgent: number;
      pendingClaims: number;
    };
    initial = {
      id: latest.id,
      ...payload
    };
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Laporan Harian</h1>
        <p className="text-sm text-muted-foreground">
          PDF dan Excel dihasilkan di server. Email bersifat mock sampai ALLOW_REAL_OUTBOUND=true.
        </p>
      </header>
      <ReportPanel initial={initial} />
    </main>
  );
}
