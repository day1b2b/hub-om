import { CoachResourceView } from "@/features/coaches/CoachResourceView";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import type { CoachScheduleView, DateRange } from "@/lib/data/coachTypes";

export const dynamic = "force-dynamic";

interface CoachResourcesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export interface CoachResourceRow {
  id: string;
  name: string;
  workType: string | null;
  schedules: CoachScheduleView[];
}

export default async function CoachResourcesPage({ searchParams }: CoachResourcesPageProps) {
  await requireWorkspaceSession();

  const params = await searchParams;
  const range = resolveRange(firstParam(params.from), firstParam(params.to));

  let rows: CoachResourceRow[] = [];
  let loadFailed = false;

  try {
    const repository = getCoachRepository();
    const coaches = (await repository.listCoaches()).filter((coach) => coach.isActive);
    rows = await Promise.all(
      coaches.map(async (coach) => ({
        id: coach.id,
        name: coach.name,
        workType: coach.workType,
        schedules: await repository.listSchedules(coach.id, range)
      }))
    );
  } catch {
    loadFailed = true;
  }

  return <CoachResourceView loadFailed={loadFailed} range={range} rows={rows} />;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveRange(from: string | undefined, to: string | undefined): DateRange {
  if (isDateString(from) && isDateString(to)) {
    return { from, to };
  }

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: formatDate(start), to: formatDate(end) };
}

function isDateString(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
