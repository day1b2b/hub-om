import { notFound } from "next/navigation";
import { CoachEngagementList } from "@/features/coaches/CoachEngagementList";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";
import { effectiveEngagementStatus, seoulTodayKey } from "@/lib/coaches/coachActivity";
import { tryListEvaluatedEngagementIds } from "@/lib/coaches/coachEvaluationService";
import { visibleCoachEngagements } from "@/lib/coaches/coachEngagementDedup";

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
  // 표시 가시성(운영현황=정본): 운영현황 출신 투입만 보인다. 계약시트·삼성 스케줄시트 등 보조 소스는
  // 숨긴다(평가 달린 줄은 보존). 평가 저장소를 못 읽으면(null) 원본을 그대로 둔다(평가 소실·페이지 500 방지).
  const visibleEngagements = protectedEngagementIds === null
    ? engagements
    : visibleCoachEngagements(engagements, protectedEngagementIds);

  return (
    <CoachEngagementList
      coachId={id}
      coachName={coach.name}
      engagements={visibleEngagements}
      feedbackByEngagement={{}}
    />
  );
}
