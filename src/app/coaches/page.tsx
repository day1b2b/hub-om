import { CoachList, type CoachListItem } from "@/features/coaches/CoachList";
import { CoachRecommendPanel } from "@/features/coaches/CoachRecommendPanel";
import { recommendCoachesByCriteria, type CoachRecommendation } from "@/features/coaches/coachRecommendation";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { coachActivityPolicy, recentRatingSummary, seoulTodayKey, summarizeCoachActivity } from "@/lib/coaches/coachActivity";
import { loadEvaluationAverages } from "@/lib/coaches/coachEvaluationAverages";
import { peopleStatusFromFacts } from "@/lib/people/peopleStatus";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";
import { timed } from "@/lib/observability/timed";

export const dynamic = "force-dynamic";

interface CoachesPageProps {
  // Next가 페이지에 항상 넘기지만, 통합테스트는 인자 없이 호출하므로 선택적으로 둔다.
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CoachesPage({ searchParams }: CoachesPageProps = {}) {
  await requireWorkspaceSession();
  const params = searchParams ? await searchParams : {};
  return runCoachPublicRequest(() => renderCoachesPage(firstParam(params.field), firstParam(params.date)));
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

async function renderCoachesPage(field: string, date: string) {
  let coaches: CoachListItem[] = [];
  let fieldOptions: string[] = [];
  let recommendation: CoachRecommendation | null = null;
  let loadFailed = false;
  // 활동 상태는 오늘 날짜에 따라 달라지므로 서버에서 한 번 계산해 내려준다(SSR·하이드레이션 일치).
  const today = seoulTodayKey();
  const coachesStartedAt = Date.now();

  try {
    const [summaries, evaluationAverages] = await Promise.all([
      timed("coaches:listCoaches", () => getCoachRepository().listCoaches()),
      timed("coaches:loadEvaluationAverages", () => loadEvaluationAverages())
    ]);
    coaches = summaries.map(({ engagementFacts, ...coach }) => ({
      ...coach,
      ...recentRatingSummary(engagementFacts, evaluationAverages),
      activity: summarizeCoachActivity(engagementFacts, today),
      peopleStatus: peopleStatusFromFacts(engagementFacts, today, coachActivityPolicy.dormantMonths)
    }));

    // 코치 추천용 전문분야 목록. 교육일·전문분야가 들어왔을 때만 추천을 계산한다(그 전엔 폼만 보여 준다).
    fieldOptions = Array.from(new Set(summaries.flatMap((coach) => coach.fields))).sort((a, b) => a.localeCompare(b, "ko"));
    if (field || date) {
      // OM 평가는 목록과 같은 기준(recentRatingSummary)으로 맞추고, 투입 날짜(engagementFacts)는 겹침 판정에 쓴다.
      const enriched = summaries.map((coach) => ({ ...coach, ...recentRatingSummary(coach.engagementFacts, evaluationAverages) }));
      recommendation = recommendCoachesByCriteria({ field, date, coaches: enriched, today, dormantMonths: coachActivityPolicy.dormantMonths });
    }
  } catch {
    loadFailed = true;
  }

  console.info(`[perf] coaches total ${Date.now() - coachesStartedAt}ms`);

  return (
    <CoachList
      coaches={coaches}
      loadFailed={loadFailed}
      recommendOpen={recommendation !== null}
      recommendPanel={<CoachRecommendPanel date={date} field={field} fieldOptions={fieldOptions} recommendation={recommendation} />}
      today={today}
    />
  );
}
