import { CoachScheduleBoard } from "@/features/coaches/CoachScheduleBoard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import type { CoachScheduleDashboard } from "@/lib/data/coachTypes";

export const dynamic = "force-dynamic";

interface CoachSchedulePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CoachSchedulePage({ searchParams }: CoachSchedulePageProps) {
  await requireWorkspaceSession();

  const params = await searchParams;
  const yearMonth = resolveYearMonth(firstParam(params.yearMonth));

  let dashboard: CoachScheduleDashboard = {
    yearMonth,
    totalActiveCoaches: 0,
    days: {}
  };
  let loadFailed = false;

  try {
    dashboard = await getCoachRepository().getScheduleDashboard(yearMonth);
  } catch {
    loadFailed = true;
  }

  return <CoachScheduleBoard dashboard={dashboard} loadFailed={loadFailed} />;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveYearMonth(value: string | undefined): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
