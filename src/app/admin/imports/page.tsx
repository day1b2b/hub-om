import { ImportAdminDashboard } from "@/features/imports/ImportAdminDashboard";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getImportRepository } from "@/lib/data/importRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function ImportRunsPage() {
  await requireAdminSession();

  const repository = getImportRepository();
  const runs = await repository.listImportRuns();

  return <ImportAdminDashboard runs={runs} />;
}
