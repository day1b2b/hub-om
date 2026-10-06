import { redirect } from "next/navigation";
import { CoachAdminPage } from "@/features/coaches/CoachAdminPage";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getCoachAdminRepository } from "@/lib/data/coachAdminRepositoryFactory";
import type { CoachAdminTab } from "@/features/coaches/CoachAdminPage";
import { runCoachAdminRequest } from "@/lib/data/coachAdminComposition";

export const dynamic = "force-dynamic";

interface CoachAdminPageRouteProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CoachAdminPageRoute({ searchParams }: CoachAdminPageRouteProps) {
  await requireAdminSession();

  const params = await searchParams;
  if (firstParam(params.tab) === "content") redirect("/changes#content");
  const selectedTab = resolveTab(firstParam(params.tab));

  const deletedCount = await runCoachAdminRequest(() => getCoachAdminRepository().countDeletedCoaches());

  return <CoachAdminPage deletedCount={deletedCount} selectedTab={selectedTab} />;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveTab(value: string | undefined): CoachAdminTab {
  if (value === "schedule-link" || value === "deleted" || value === "sync") {
    return value;
  }
  return "schedule-link";
}
