import { CoachAdminPage } from "@/features/coaches/CoachAdminPage";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";
import type { CoachAdminTab } from "@/features/coaches/CoachAdminPage";

export const dynamic = "force-dynamic";

interface CoachAdminPageRouteProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CoachAdminPageRoute({ searchParams }: CoachAdminPageRouteProps) {
  await requireWorkspaceSession();

  const params = await searchParams;
  const selectedTab = resolveTab(firstParam(params.tab));

  const prisma = getPrismaClient();
  const deletedCount = await prisma.coach.count({ where: { deletedAt: { not: null } } });

  return <CoachAdminPage deletedCount={deletedCount} selectedTab={selectedTab} />;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveTab(value: string | undefined): CoachAdminTab {
  if (value === "schedule-link" || value === "deleted" || value === "sync" || value === "content") {
    return value;
  }
  return "schedule-link";
}
