import type { SatisfactionMatchResult } from "@/lib/data/satisfactionSheet";

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
}

export interface RoundApplyDecision {
  /** DB 에 쓸지 */
  write: boolean;
  status: RoundApplyStatus;
  /** 사용자에게 그대로 보여줄 문장 — 조용한 실패를 만들지 않는다 */
  message: string;
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

  const previous = (operation.avgSatisfaction ?? "").trim();
  const label = operationLabel(operation);

  if (previous === value) {
    return {
      write: false,
      status: "same",
      message: "이미 같은 값이라 그대로 두었어요.",
      operationId: match.operationId,
      operationLabel: label,
      value,
      previous
    };
  }

  return {
    write: true,
    status: previous ? "overwritten" : "filled",
    message: previous ? `만족도를 ${previous} → ${value} 로 바꿨어요.` : `만족도 ${value} 를 반영했어요.`,
    operationId: match.operationId,
    operationLabel: label,
    value,
    previous: previous || null
  };
}
