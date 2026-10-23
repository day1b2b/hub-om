import { notFound } from "next/navigation";
import { CoachEngagementList } from "@/features/coaches/CoachEngagementList";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";
import { effectiveEngagementStatus, seoulTodayKey } from "@/lib/coaches/coachActivity";

export const dynamic = "force-dynamic";

interface CoachEngagementsPageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachEngagementsPage({ params }: CoachEngagementsPageProps) {
  await requireAdminSession();
  return runCoachPublicRequest(() => renderCoachEngagementsPage(params));
}

async function renderCoachEngagementsPage(params: CoachEngagementsPageProps["params"]) {
  const { id } = await params;

  const repository = getCoachRepository();
  const coach = await repository.getCoachById(id);

  if (!coach) {
    notFound();
  }

  const today = seoulTodayKey();
  // 저장된 상태는 동기화 때만 계산돼 지난 일정이 "예정"으로 남는다. 화면에서는 날짜로 다시 정한다.
  const engagements = (await repository.listEngagements(id)).map((engagement) => ({
    ...engagement,
    status: effectiveEngagementStatus(engagement, today)
  }));

  return (
    <CoachEngagementList
      coachId={id}
      coachName={coach.name}
      engagements={engagements}
      feedbackByEngagement={{}}
    />
  );
}
