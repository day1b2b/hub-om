import { ImportAdminDashboard } from "@/features/imports/ImportAdminDashboard";
import { PrismaImportRepository } from "@/lib/data/prismaImportRepository";

export const dynamic = "force-dynamic";

export default async function ImportRunsPage() {
  const repository = new PrismaImportRepository();
  const runs = await repository.listImportRuns();

  return <ImportAdminDashboard runs={runs} />;
}
