import { notFound } from "next/navigation";
import { CoachEngagementList } from "@/features/coaches/CoachEngagementList";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";
import { effectiveEngagementStatus, seoulTodayKey } from "@/lib/coaches/coachActivity";
import { tryListEvaluatedEngagementIds } from "@/lib/coaches/coachEvaluationService";
import { dedupeCoachEngagements } from "@/lib/coaches/coachEngagementDedup";

export const dynamic = "force-dynamic";

interface CoachEngagementsPageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachEngagementsPage({ params }: CoachEngagementsPageProps) {
  await requireWorkspaceSession();
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
  const [storedEngagements, protectedEngagementIds] = await Promise.all([
    repository.listEngagements(id),
    tryListEvaluatedEngagementIds(id)
  ]);
  // 저장된 상태는 동기화 때만 계산돼 지난 일정이 "예정"으로 남는다. 화면에서는 날짜로 다시 정한다.
  const engagements = storedEngagements.map((engagement) => ({
    ...engagement,
    status: effectiveEngagementStatus(engagement, today)
  }));
  // 중복정리(P1c): 카드와 같은 규칙으로 운영현황과 겹치는 계약시트 투입을 숨긴다(평가 달린 줄은 보존).
  // 평가 저장소를 못 읽으면(null) 디듑을 건너뛰고 원본을 그대로 둔다(평가 소실·페이지 500 방지).
  const visibleEngagements = protectedEngagementIds === null
    ? engagements
    : dedupeCoachEngagements(engagements, protectedEngagementIds);

  return (
    <CoachEngagementList
      coachId={id}
      coachName={coach.name}
      engagements={visibleEngagements}
      feedbackByEngagement={{}}
    />
  );
}
