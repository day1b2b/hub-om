import { CoachList, type CoachListItem } from "@/features/coaches/CoachList";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { recentRatingSummary, seoulTodayKey, summarizeCoachActivity } from "@/lib/coaches/coachActivity";
import { storedEvaluationAverage } from "@/lib/coaches/coachEvaluationRules";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { getCoachEvaluationRepository } from "@/lib/data/coachEvaluationRepositoryFactory";
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";

export const dynamic = "force-dynamic";

export default async function CoachesPage() {
  await requireAdminSession();
  return runCoachPublicRequest(renderCoachesPage);
}

/** 새 OM 평가의 투입별 평균. 평가 저장소를 못 열면 비워 두고 예전 평점으로 보여준다. */
async function loadEvaluationAverages(): Promise<Map<string, number>> {
  const averages = new Map<string, number>();
  try {
    for (const input of await getCoachEvaluationRepository().listOmAverageInputs()) {
      const average = storedEvaluationAverage(input.scores);
      if (input.engagementId && average !== null) averages.set(input.engagementId, average);
    }
  } catch {
    console.error("[coaches] evaluation averages unavailable");
    averages.clear();
  }
  return averages;
}

async function renderCoachesPage() {
  let coaches: CoachListItem[] = [];
  let loadFailed = false;
  // 활동 상태는 오늘 날짜에 따라 달라지므로 서버에서 한 번 계산해 내려준다(SSR·하이드레이션 일치).
  const today = seoulTodayKey();

  try {
    const [summaries, evaluationAverages] = await Promise.all([getCoachRepository().listCoaches(), loadEvaluationAverages()]);
    coaches = summaries.map(({ engagementFacts, ...coach }) => ({
      ...coach,
      ...recentRatingSummary(engagementFacts, evaluationAverages),
      activity: summarizeCoachActivity(engagementFacts, today)
    }));
  } catch {
    loadFailed = true;
  }

  return <CoachList coaches={coaches} loadFailed={loadFailed} today={today} />;
}
