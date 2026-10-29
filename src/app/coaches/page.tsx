import { CoachList, type CoachListItem } from "@/features/coaches/CoachList";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { coachActivityPolicy, recentRatingSummary, seoulTodayKey, summarizeCoachActivity } from "@/lib/coaches/coachActivity";
import { loadEvaluationAverages } from "@/lib/coaches/coachEvaluationAverages";
import { peopleStatusFromFacts } from "@/lib/people/peopleStatus";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";

export const dynamic = "force-dynamic";

export default async function CoachesPage() {
  await requireAdminSession();
  return runCoachPublicRequest(renderCoachesPage);
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
      activity: summarizeCoachActivity(engagementFacts, today),
      peopleStatus: peopleStatusFromFacts(engagementFacts, today, coachActivityPolicy.dormantMonths)
    }));
  } catch {
    loadFailed = true;
  }

  return <CoachList coaches={coaches} loadFailed={loadFailed} today={today} />;
}
