// 코치 투입이력 "표시 가시성" 결정. 순수 함수(I/O 없음 → 단위테스트 격리).
//
// 정책(2026-11, 운영현황=정본):
// - 투입현황에는 "운영현황(실습코치 coachText) 출신" 투입만 보인다(operationBacked=true).
// - 계약시트·삼성 스케줄시트 등 보조 소스 투입(operationBacked=false)은 투입현황에서 숨긴다.
//   데이터는 지우지 않는다(종료 후 담당 매니저 알림 등 다른 용도로 보존).
// - 단, 평가(OM)·피드백·사실기록·rehire가 달린 줄은 보조 소스라도 숨기지 않는다(#978 평가 소실 금지).
// - operationBacked가 미지정(undefined)이면 판정 불가로 보고 숨기지 않는다(데이터 소실보다 노출이 안전).
import type { CoachEngagementView } from "../data/coachTypes";

/** 평가·피드백·사실기록·rehire가 달려 숨기면 안 되는 줄인가. */
function hasAttachedContent(e: CoachEngagementView, protectedEngagementIds: ReadonlySet<string>): boolean {
  return (
    protectedEngagementIds.has(e.id) ||
    e.rating !== null ||
    e.rehire !== null ||
    (typeof e.feedback === "string" && e.feedback.trim().length > 0)
  );
}

/**
 * 투입현황에 보일 투입만 남긴다(입력 순서 보존).
 * 운영현황 출신(operationBacked)·평가 달린 줄은 남기고, 그 밖의 보조 소스 투입은 숨긴다.
 */
export function visibleCoachEngagements(
  engagements: ReadonlyArray<CoachEngagementView>,
  protectedEngagementIds: ReadonlySet<string> = new Set()
): CoachEngagementView[] {
  return engagements.filter(
    (e) => e.operationBacked !== false || hasAttachedContent(e, protectedEngagementIds)
  );
}
