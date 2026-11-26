import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { TriageForm } from "@/components/triage-form";

export default async function TriagePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  if (!hasPermission(session.user.role, "triage:read")) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Akses ditolak</h1>
        <p className="text-sm text-muted-foreground">Peran Anda tidak memiliki izin triage.</p>
      </main>
    );
  }

  const patients = await prisma.patient.findMany({
    select: { id: true, name: true, nikMasked: true },
    orderBy: { name: "asc" },
    take: 100
  });

  return <TriageForm patients={patients} />;
}
