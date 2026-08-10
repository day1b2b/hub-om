import type { SatisfactionMatchResult } from "@/lib/data/satisfactionSheet";

/**
 * 만족도 반영 계획 — "무엇을 쓸지"를 DB 접근 없이 순수하게 결정한다.
 * API route는 이 계획을 그대로 실행만 한다(안전 규칙을 한 곳에서 검증·테스트할 수 있게).
 *
 * 규칙 (docs/operations/db-write-safety.md 기준, 2026-08-10 승인):
 *   1. matched만 쓴다. ambiguous·unmatched는 절대 쓰지 않는다.
 *   2. 시트 만족도 값이 비어 있으면 쓰지 않는다.
 *   3. 이미 값이 있는 회차는 건드리지 않는다(사람이 넣은 값 보호).
 */

/** 반영 판단에 필요한 운영 정보만 (repository 타입 전체에 의존하지 않는다) */
export interface ApplyTargetOperation {
  operationId: string;
  avgSatisfaction?: string | null;
  companyName?: string | null;
  courseName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface SatisfactionApplyItem {
  operationId: string;
  /** 기록할 만족도 값 (시트 기준) */
  value: string;
  /** 화면·로그용 운영 표시 이름 */
  label: string;
  recordId: string;
  course: string;
  date: string;
}

export interface SatisfactionSkipItem {
  course: string;
  date: string;
  reason: string;
}

export interface SatisfactionApplyPlan {
  apply: SatisfactionApplyItem[];
  skip: SatisfactionSkipItem[];
  /** 매칭은 됐지만 운영 정보를 찾지 못한 건 (데이터 불일치 — 조용히 넘기지 않는다) */
  missing: SatisfactionSkipItem[];
}

function operationLabel(operation: ApplyTargetOperation): string {
  const name = [operation.companyName, operation.courseName].filter(Boolean).join(" / ");
  const period = operation.startDate && operation.endDate ? ` (${operation.startDate}~${operation.endDate})` : "";
  return `${name || operation.operationId}${period}`;
}

export function planSatisfactionApply(
  results: SatisfactionMatchResult[],
  operationsById: Map<string, ApplyTargetOperation>
): SatisfactionApplyPlan {
  const plan: SatisfactionApplyPlan = { apply: [], skip: [], missing: [] };

  for (const result of results) {
    if (result.status !== "matched" || !result.operationId) continue;

    const { course, date, overall, recordId } = result.row;
    const operation = operationsById.get(result.operationId);
    if (!operation) {
      plan.missing.push({ course, date, reason: "매칭된 운영 정보를 찾지 못했어요." });
      continue;
    }
    if (!overall) {
      plan.skip.push({ course, date, reason: "시트 만족도 값이 비어 있어요." });
      continue;
    }
    const existing = (operation.avgSatisfaction ?? "").trim();
    if (existing !== "") {
      plan.skip.push({ course, date, reason: `이미 입력된 값(${existing})이 있어 그대로 두었어요.` });
      continue;
    }

    plan.apply.push({
      operationId: operation.operationId,
      value: overall,
      label: operationLabel(operation),
      recordId,
      course,
      date
    });
  }

  return plan;
}
