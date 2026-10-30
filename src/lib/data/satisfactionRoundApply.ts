import type { SatisfactionMatchResult } from "@/lib/data/satisfactionSheet";
import { optionalText, parseRespondents, type SessionSurveyResultInput, type SurveyComments } from "@/lib/data/sessionSurveyResultTypes";

/**
 * 만족도 회차 단위 반영 계획 — "쓸지 말지"를 DB 접근 없이 순수하게 결정한다.
 * API route 는 이 결정을 실행만 한다(안전 규칙을 한 곳에서 검증·테스트할 수 있게).
 *
 * 규칙 (docs/operations/db-write-safety.md, 2026-08-10 도입 → 2026-08-31 개정):
 *   1. matched 만 쓴다. 모호·미매칭은 쓰지 않는다.
 *   2. 만족도 값이 비어 있으면 쓰지 않는다.
 *   3. ★기존 값이 있어도 덮어쓴다. [2026-08-31 변경]
 *      원래 3번은 "이미 값이 있으면 건드리지 않는다" 였다. 목적은 사람이 손으로 넣은 값 보호였는데,
 *      hub-om 에 만족도 수기 입력 경로가 없어 실제로 보호하던 것은 드라이브 임포트 값뿐이었다.
 *      데이터 책임자(시트 관리자)가 시트를 원본으로 확정했고 드라이브 임포트 작성자도 동의했다.
 *      덮어쓰지 않으면 앱에서 값을 고쳐도 hub-om 이 옛 값으로 남아 사람이 직접 들어가야 한다.
 *   4. 값이 같으면 쓰지 않는다 — 의미 없는 갱신으로 로그를 늘리지 않는다.
 */

export type RoundApplyStatus =
  | "filled" // 빈 칸을 채웠다
  | "overwritten" // 기존 값을 바꿨다
  | "same" // 이미 같은 값
  | "empty" // 시트 만족도가 비어 있다
  | "ambiguous" // 회차 후보가 여러 개
  | "unmatched" // 맞는 회차 없음
  | "missing"; // 매칭은 됐는데 운영 정보를 못 찾음

export interface RoundApplyTarget {
  id: string;
  operationId?: string;
  companyName?: string | null;
  courseName?: string | null;
  avgSatisfaction?: string | null;
  instructorSatisfaction?: string | null;
}

export interface RoundApplyDecision {
  /** DB 에 쓸지 */
  write: boolean;
  status: RoundApplyStatus;
  /** 사용자에게 그대로 보여줄 문장 — 조용한 실패를 만들지 않는다 */
  message: string;
  /**
   * ★쓰기에 쓰는 키 = 운영의 업무 키(operationId).
   * 매칭 결과가 돌려주는 것은 행 id 이고, updateOperation 은 `where: { operationId }` 로 찾는다.
   * 이 둘을 헷갈리면 매칭은 맞는데 쓰기만 "No record was found for an update" 로 실패한다
   * (2026-09-03 실제로 겪음). 관리자 경로(satisfactionApplyPlan)와 같은 키를 쓴다.
   */
  operationId?: string;
  operationLabel?: string;
  value?: string;
  previous?: string | null;
}

export function operationLabel(operation: RoundApplyTarget): string {
  const name = [operation.companyName, operation.courseName].filter(Boolean).join(" / ");
  return name || operation.operationId || operation.id;
}

export function planRoundApply(
  overall: string,
  match: SatisfactionMatchResult,
  findOperation: (operationId: string) => RoundApplyTarget | undefined
): RoundApplyDecision {
  const value = (overall ?? "").trim();
  if (!value) {
    return { write: false, status: "empty", message: "만족도 값이 비어 있어 반영하지 않았어요." };
  }

  if (match.status === "ambiguous") {
    return {
      write: false,
      status: "ambiguous",
      message: "회차 후보가 여러 개라 반영하지 않았어요. 코스ID와 강의일정을 확인해 주세요."
    };
  }
  if (match.status === "unmatched" || !match.operationId) {
    return {
      write: false,
      status: "unmatched",
      message: match.reason ?? "맞는 운영 회차를 찾지 못했어요."
    };
  }

  const operation = findOperation(match.operationId);
  if (!operation) {
    return { write: false, status: "missing", message: "매칭된 운영 정보를 찾지 못했어요." };
  }

  // 쓰기 키는 행 id 가 아니라 업무 키다. 없으면 쓰지 않는다 —
  // 엉뚱한 키로 쓰는 것보다 못 썼다고 알리는 게 낫다.
  const writeKey = (operation.operationId ?? "").trim();
  if (!writeKey) {
    return { write: false, status: "missing", message: "운영 회차의 식별자(operationId)가 없어 반영하지 않았어요." };
  }

  const previous = (operation.avgSatisfaction ?? "").trim();
  const label = operationLabel(operation);

  if (previous === value) {
    return {
      write: false,
      status: "same",
      message: "이미 같은 값이라 그대로 두었어요.",
      operationId: writeKey,
      operationLabel: label,
      value,
      previous
    };
  }

  return {
    write: true,
    status: previous ? "overwritten" : "filled",
    message: previous ? `만족도를 ${previous} → ${value} 로 바꿨어요.` : `만족도 ${value} 를 반영했어요.`,
    operationId: writeKey,
    operationLabel: label,
    value,
    previous: previous || null
  };
}

/**
 * 강사 만족도(강사 3성분 평균)를 같이 쓸지 정한다. 쓸 값이면 문자열, 아니면 null.
 *   - 종합 만족도를 쓰는 경우(write)에는 지금처럼 같이 쓴다.
 *   - 종합이 이미 같은 값이라 쓰지 않는 경우(same)에는 ★강사 만족도 칸이 비어 있을 때만 채운다.
 *     강사 만족도 칸이 생기기 전(2026-09-23)에 반영된 회차를 다시 보냈을 때 강사 값만 빠지는 것을 막는다.
 *     이미 있는 강사 값은 바꾸지 않는다.
 *   - 그 밖(모호·미매칭·종합 비어 있음 등)에는 쓰지 않는다.
 *   - 5점 척도 밖이거나 숫자가 아니면 쓰지 않는다.
 */
export function planInstructorSatisfaction(
  decision: RoundApplyDecision,
  instructorSatisfaction: string | null | undefined,
  current: RoundApplyTarget | undefined
): string | null {
  const value = (instructorSatisfaction ?? "").trim();
  const score = Number.parseFloat(value);
  if (!value || !Number.isFinite(score) || score <= 0 || score > 5) return null;
  if (decision.write) return value;
  if (decision.status === "same" && current && !(current.instructorSatisfaction ?? "").trim()) return value;
  return null;
}

/** 5점 척도 안의 숫자 문자열만 남긴다(강사 만족도 반영 규칙과 같은 기준). */
function scoreText(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  const score = Number.parseFloat(text);
  return text && Number.isFinite(score) && score > 0 && score <= 5 ? text : null;
}

/**
 * 회차별 만족도 결과(SessionSurveyResult)로 남길 내용을 정한다. 남기지 않으면 null.
 *   - 회차가 확정된 경우(종합을 썼거나 이미 같은 값)에만 남긴다. 모호·미매칭·종합 비어 있음은 남기지 않는다.
 *   - 측정값은 이번 요청에 실려 온 그대로 덮어쓴다(누른 시점 = 최종본).
 *   - comments가 undefined면(구버전 앱) 저장소가 기존 코멘트를 그대로 둔다.
 */
export function planSurveyResult(
  decision: RoundApplyDecision,
  sent: {
    recordId?: string;
    instructorSatisfaction?: string;
    n?: string;
    posPct?: string;
    manager?: string;
    comments?: SurveyComments;
  }
): SessionSurveyResultInput | null {
  if (!decision.operationId || !decision.value) return null;
  if (!decision.write && decision.status !== "same") return null;
  return {
    operationId: decision.operationId,
    recordId: optionalText(sent.recordId),
    overall: decision.value,
    instructorSatisfaction: scoreText(sent.instructorSatisfaction),
    respondents: parseRespondents(sent.n),
    positiveRate: optionalText(sent.posPct),
    ...(sent.comments ? { comments: sent.comments } : {}),
    appliedBy: optionalText(sent.manager)
  };
}

const compactName = (value: string) => value.replace(/\s+/g, "").toLowerCase();

/**
 * [hub-om 반영]을 담당 OM이 아닌 사람이 눌렀는지. 막지는 않고 응답에 알리기만 한다(휴가·대리 반영이 있다).
 *   - 누른 사람 이메일이 멤버 관리(TeamUser)에 있으면 그 이름이 담당 OM·현장 OM 표기에 있는지로 본다.
 *     운영 회차의 OM 칸은 이름("이유진C")이고 요청은 이메일(yj.lee@…)이라, 이름끼리 맞대야 한다.
 *   - 멤버에 없는 이메일이면 예전 방식(이메일 @ 앞부분이 표기에 들어 있는지)으로 대신 본다.
 *   (2026-10-30: 예전 방식만 쓰면 영문 아이디와 한글 표기가 늘 달라 거의 모든 반영이 "다른 사람"으로 찍혔다.)
 */
export function isAppliedByOther(input: { submitterEmail: string; ownerText: string; submitterNames: readonly string[] }): boolean {
  const submitter = input.submitterEmail.trim().toLowerCase();
  const owners = input.ownerText.split(/[,/·]+/).map(compactName).filter(Boolean);
  if (!submitter || owners.length === 0) return false;
  const names = input.submitterNames.map(compactName).filter(Boolean);
  if (names.length > 0) return !names.some((name) => owners.some((owner) => owner === name || owner.includes(name)));
  const localPart = submitter.split("@")[0];
  return !owners.some((owner) => owner.includes(localPart));
}
