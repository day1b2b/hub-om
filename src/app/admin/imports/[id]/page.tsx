import { notFound } from "next/navigation";
import { ImportRunDetailView } from "@/features/imports/ImportAdminDashboard";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getImportRepository } from "@/lib/data/importRepositoryFactory";

export const dynamic = "force-dynamic";

interface ImportRunPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ImportRunPage({ params }: ImportRunPageProps) {
  await requireAdminSession();

  const { id } = await params;
  const repository = getImportRepository();
  const run = await repository.getImportRunById(id);

  if (!run) {
    notFound();
  }

  return <ImportRunDetailView run={run} />;
}
