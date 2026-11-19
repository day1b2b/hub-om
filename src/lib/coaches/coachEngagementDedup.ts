// 코치 투입이력 읽기 단계 중복정리(P1c). 순수 함수(I/O 없음, 타입만 import → 단위테스트 격리).
//
// 배경: 투입 정본은 운영현황 '실습코치'(source=MANUAL)다. 계약시트(source=SHEET)에서 들어온 투입이
// 같은 실제 투입을 가리키면 카드·표에 중복으로 뜬다. 여기서 "날짜가 겹치는" MANUAL↔SHEET를 같은 투입으로
// 보고, 운영현황(MANUAL/확정)을 남기고 계약시트(SHEET) 쪽을 숨긴다.
//
// 안전 규칙(#978 롤백 교훈 — 평가 소실 금지):
// - 평가(OM)·피드백·사실기록이 달린 줄은 절대 숨기지 않는다(protectedEngagementIds / rating / rehire / feedback).
// - 짝(겹치는 활성 MANUAL)이 없는 SHEET는 그대로 둔다(아직 운영현황에 안 적힌 투입).
// - 취소된 MANUAL은 '덮어쓰는 확정'으로 치지 않는다(SHEET를 숨기는 근거로 쓰지 않음).
import type { CoachEngagementView } from "../data/coachTypes";

const toDay = (value: string): string => value.slice(0, 10); // "YYYY-MM-DD"
const isCancelled = (e: CoachEngagementView): boolean => (e.status ?? "").toLowerCase() === "cancelled";

/** 두 투입의 날짜 구간이 겹치는가([start,end] 포함). */
function overlaps(a: CoachEngagementView, b: CoachEngagementView): boolean {
  return toDay(a.startDate) <= toDay(b.endDate) && toDay(b.startDate) <= toDay(a.endDate);
}

/** 평가·피드백·사실기록이 달려 숨기면 안 되는 줄인가. */
function hasAttachedContent(e: CoachEngagementView, protectedEngagementIds: ReadonlySet<string>): boolean {
  return (
    protectedEngagementIds.has(e.id) ||
    e.rating !== null ||
    e.rehire !== null ||
    (typeof e.feedback === "string" && e.feedback.trim().length > 0)
  );
}

/**
 * 같은 코치의 투입 목록에서, 활성 운영현황(MANUAL)과 날짜가 겹치는 계약시트(SHEET) 투입을 숨긴다.
 * 입력 순서를 보존한다. source는 소문자("manual"/"sheet") 기준.
 */
export function dedupeCoachEngagements(
  engagements: ReadonlyArray<CoachEngagementView>,
  protectedEngagementIds: ReadonlySet<string> = new Set()
): CoachEngagementView[] {
  const activeManuals = engagements.filter((e) => e.source === "manual" && !isCancelled(e));
  if (activeManuals.length === 0) return [...engagements];
  return engagements.filter((e) => {
    if (e.source !== "sheet") return true; // MANUAL 등은 항상 유지
    if (hasAttachedContent(e, protectedEngagementIds)) return true; // 평가/내용 보호
    return !activeManuals.some((manual) => overlaps(manual, e)); // 겹치는 활성 운영현황이 있으면 숨김
  });
}
