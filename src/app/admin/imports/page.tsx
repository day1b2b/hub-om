import { ImportAdminDashboard } from "@/features/imports/ImportAdminDashboard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { PrismaImportRepository } from "@/lib/data/prismaImportRepository";

export const dynamic = "force-dynamic";

export default async function ImportRunsPage() {
  await requireWorkspaceSession();

  const repository = new PrismaImportRepository();
  const runs = await repository.listImportRuns();

  return <ImportAdminDashboard runs={runs} />;
}
