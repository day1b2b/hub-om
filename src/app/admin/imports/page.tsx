import { ImportAdminDashboard } from "@/features/imports/ImportAdminDashboard";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { PrismaImportRepository } from "@/lib/data/prismaImportRepository";

export const dynamic = "force-dynamic";

export default async function ImportRunsPage() {
  await requireAdminSession();

  const repository = new PrismaImportRepository();
  const runs = await repository.listImportRuns();

  return <ImportAdminDashboard runs={runs} />;
}
