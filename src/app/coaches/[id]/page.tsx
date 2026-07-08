import { notFound } from "next/navigation";
import { CoachDetailView } from "@/features/coaches/CoachDetail";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import type { CoachDetailTab } from "@/features/coaches/CoachDetail";

export const dynamic = "force-dynamic";

interface CoachDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CoachDetailPage({ params, searchParams }: CoachDetailPageProps) {
  await requireWorkspaceSession();
  const { id } = await params;
  const query = await searchParams;
  const selectedTab = resolveTab(firstParam(query.tab));
  const selectedMonth = resolveMonth(firstParam(query.month));
  const monthRange = rangeFromMonth(selectedMonth);

  const repository = getCoachRepository();
  const coach = await repository.getCoachById(id);

  if (!coach) {
    notFound();
  }

  const [engagements, schedules, engagementSchedules] = await Promise.all([
    repository.listEngagements(id),
    repository.listSchedules(id, monthRange),
    repository.listEngagementSchedules(id, monthRange)
  ]);

  return (
    <CoachDetailView
      coach={coach}
      engagementSchedules={engagementSchedules}
      engagements={engagements}
      selectedMonth={selectedMonth}
      schedules={schedules}
      selectedTab={selectedTab}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveTab(value: string | undefined): CoachDetailTab {
  if (value === "schedule" || value === "engagements") return value;
  return "profile";
}

function resolveMonth(value: string | undefined): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function rangeFromMonth(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { from: formatDate(start), to: formatDate(end) };
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
