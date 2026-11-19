// 코치 투입이력 읽기 단계 중복정리(P1c). 순수 함수(I/O 없음 → 단위테스트 격리).
//
// 배경: 투입 정본은 운영현황 '실습코치'(source=MANUAL)다. 계약시트(source=SHEET)에서 들어온 투입이
// 같은 실제 투입을 가리키면 카드·표에 중복으로 뜬다. 여기서 "같은 투입"으로 볼 때만 운영현황(MANUAL/확정)을
// 남기고 계약시트(SHEET) 쪽을 숨긴다.
//
// "같은 투입" 판정(둘 다 필요 — 날짜만으론 부족):
// - 날짜 구간이 겹치고, AND
// - 같은 회차(operationSessionId 일치) 이거나 같은 과정(과정명 정규화 일치)
//   → 같은 코치가 같은 날 '다른 과정' 2건을 뛰는 경우, 날짜만 겹친다고 멀쩡한 다른 과정 계약건을
//      숨기지 않는다.
//   → 과정명은 normalizeCourseName(표기 정규화: NFKC·공백·대소문자)으로만 비교하고, 괄호/대괄호
//      '꼬리표'는 일부러 보존한다. "(기초)/(심화)", "(1반)/(2반)", "(오전)/(오후)"처럼 꼬리표가
//      서로 다른 딜리버리를 가르는 유일 변별자인 경우가 흔해, 이를 지우면(simplifyCourseName) 다른
//      투입을 같은 과정으로 뭉개 과대숨김한다(적대적 리뷰 확정 결함). 꼬리표가 다르면 '다른 투입'으로 본다.
//      과정명을 판정할 수 없으면(빈 값) 숨기지 않는다(데이터 소실보다 중복 노출이 안전).
//   한계: courseId가 뷰에 없어 과정명 '글자'에 의존한다. 꼬리표 없이 과정명이 완전히 같은 병렬 분반은
//      여전히 구분 못 하므로, 겹치는 활성 MANUAL 1건과만 같은 투입으로 간주된다(그 이상은 사람 확인).
//
// 안전 규칙(#978 롤백 교훈 — 평가 소실 금지):
// - 평가(OM)·피드백·사실기록이 달린 줄은 절대 숨기지 않는다(protectedEngagementIds / rating / rehire / feedback).
// - 짝(같은 투입으로 보이는 활성 MANUAL)이 없는 SHEET는 그대로 둔다(아직 운영현황에 안 적힌 투입).
// - 취소된 MANUAL은 '덮어쓰는 확정'으로 치지 않는다(SHEET를 숨기는 근거로 쓰지 않음).
import type { CoachEngagementView } from "../data/coachTypes";
import { normalizeCourseName } from "../data/operationMatch/matchOperation";

const toDay = (value: string): string => value.slice(0, 10); // "YYYY-MM-DD"
const isCancelled = (e: CoachEngagementView): boolean => (e.status ?? "").toLowerCase() === "cancelled";

/** 두 투입의 날짜 구간이 겹치는가([start,end] 포함). */
function overlaps(a: CoachEngagementView, b: CoachEngagementView): boolean {
  return toDay(a.startDate) <= toDay(b.endDate) && toDay(b.startDate) <= toDay(a.endDate);
}

/** 같은 회차를 가리키는가(둘 다 operationSessionId가 있고 일치). */
function sameSession(a: CoachEngagementView, b: CoachEngagementView): boolean {
  return a.operationSessionId !== null && a.operationSessionId === b.operationSessionId;
}

/**
 * 같은 과정인가. 표기 정규화(normalizeCourseName)만 적용하고 괄호/대괄호 꼬리표는 보존한다.
 * ("(기초)/(심화)", "(1반)/(2반)" 등 꼬리표가 다르면 '다른 투입'으로 본다.) 빈 과정명은 일치로 보지 않는다.
 */
function sameCourse(a: CoachEngagementView, b: CoachEngagementView): boolean {
  const an = normalizeCourseName(a.courseName ?? "");
  const bn = normalizeCourseName(b.courseName ?? "");
  return an.length > 0 && an === bn;
}

/** SHEET 줄 e가 활성 MANUAL m과 '같은 투입'인가(날짜 겹침 + 같은 회차 또는 같은 과정). */
function isSameEngagement(m: CoachEngagementView, e: CoachEngagementView): boolean {
  return overlaps(m, e) && (sameSession(m, e) || sameCourse(m, e));
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
    return !activeManuals.some((manual) => isSameEngagement(manual, e)); // 같은 투입인 활성 운영현황이 있으면 숨김
  });
}
