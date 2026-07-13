import { CoachScheduleBoard } from "@/features/coaches/CoachScheduleBoard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { fetchKoreanHolidays } from "@/lib/holidayApi";
import type { CoachScheduleDashboard } from "@/lib/data/coachTypes";

export const dynamic = "force-dynamic";

interface CoachSchedulePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CoachSchedulePage({ searchParams }: CoachSchedulePageProps) {
  await requireWorkspaceSession();

  const params = await searchParams;
  const yearMonth = resolveYearMonth(firstParam(params.yearMonth));
  const dateParam = firstParam(params.date);
  const initialDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;

  let dashboard: CoachScheduleDashboard = {
    yearMonth,
    totalActiveCoaches: 0,
    days: {}
  };
  let loadFailed = false;

  const [dashboardResult, holidays] = await Promise.allSettled([
    getCoachRepository().getScheduleDashboard(yearMonth),
    fetchKoreanHolidays(yearMonth),
  ]);

  if (dashboardResult.status === "fulfilled") {
    dashboard = dashboardResult.value;
  } else {
    loadFailed = true;
  }

  const holidayMap = holidays.status === "fulfilled" ? holidays.value : {};

  return (
    <CoachScheduleBoard
      dashboard={dashboard}
      holidays={holidayMap}
      initialDate={initialDate}
      loadFailed={loadFailed}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveYearMonth(value: string | undefined): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
