import { notFound } from "next/navigation";
import { CoachDetailView } from "@/features/coaches/CoachDetail";
import { isCoachPiiViewer } from "@/lib/auth/requireAdminSession";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { readCoachPrivateProfile } from "@/lib/data/coachPrivateAccess";
import type { CoachDetailTab } from "@/features/coaches/CoachDetail";

export const dynamic = "force-dynamic";

interface CoachDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CoachDetailPage({ params, searchParams }: CoachDetailPageProps) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const query = await searchParams;
  const admin = isCoachPiiViewer(session.user?.email);
  const selectedTab = resolveTab(firstParam(query.tab));

  const repository = getCoachRepository();
  const coach = await repository.getCoachById(id);

  if (!coach) {
    notFound();
  }

  const [engagements, schedules] = await Promise.all([
    repository.listEngagements(id),
    repository.listSchedules(id, currentMonthRange())
  ]);

  // PII는 admin일 때만 서버사이드에서 조회한다. (비-admin이 호출하면 throw)
  const privateProfile = admin ? await readCoachPrivateProfile(id, "coach_detail") : null;

  return (
    <CoachDetailView
      coach={coach}
      engagements={engagements}
      privateProfile={privateProfile}
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

function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: formatDate(start), to: formatDate(end) };
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
