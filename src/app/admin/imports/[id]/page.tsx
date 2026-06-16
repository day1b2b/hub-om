import { notFound } from "next/navigation";
import { ImportRunDetailView } from "@/features/imports/ImportAdminDashboard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { PrismaImportRepository } from "@/lib/data/prismaImportRepository";

export const dynamic = "force-dynamic";

interface ImportRunPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ImportRunPage({ params }: ImportRunPageProps) {
  await requireWorkspaceSession();

  const { id } = await params;
  const repository = new PrismaImportRepository();
  const run = await repository.getImportRunById(id);

  if (!run) {
    notFound();
  }

  return <ImportRunDetailView run={run} />;
}
