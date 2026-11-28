import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canAccessAudit } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export default async function AuditPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!canAccessAudit(session.user.role)) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Akses ditolak</h1>
      </main>
    );
  }

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { name: true, role: true } } }
  });

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold">Audit Log</h1>
      <p className="text-sm text-muted-foreground">
        Siapa, kapan, akses siapa, dan alamat IP (retensi 1 tahun).
      </p>
      <table className="mt-4 w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <th className="pb-2">Waktu</th>
            <th>Aktor</th>
            <th>Peran</th>
            <th>Aksi</th>
            <th>Target</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-t">
              <td className="py-2">{log.createdAt.toLocaleString("id-ID")}</td>
              <td>{log.actor.name}</td>
              <td>{log.actor.role}</td>
              <td>{log.action}</td>
              <td>{log.targetPatientId ?? "-"}</td>
              <td>{log.ipAddress}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
