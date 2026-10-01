import { ImportAdminDashboard } from "@/features/imports/ImportAdminDashboard";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getImportRepository } from "@/lib/data/importRepositoryFactory";
import { runImportPagesRequest } from "@/lib/data/importPagesComposition";

export const dynamic = "force-dynamic";

export default async function ImportRunsPage() {
  return runImportPagesRequest(async () => {
    await requireAdminSession();

    const repository = getImportRepository();
    const runs = await repository.listImportRuns();

    return <ImportAdminDashboard runs={runs} />;
  });
}
