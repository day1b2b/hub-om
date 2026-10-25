// =============================================================================
// 코치 OM 평가 규칙 (운영 정책 "평가·등급" 3절 루브릭)
// - 화면·API·저장소가 같은 규칙을 쓴다. 저장값은 정규화된 값만 받는다.
// - 기준 숫자는 화면 문구에 쓰지 않는다(정책 비공개 원칙).
// =============================================================================

export type CoachEngagementRoleValue = "PRACTICE_COACH" | "LEAD" | "OPERATION_ASSISTANT";
export type CoachPracticeDifficultyValue = "A" | "B" | "C";
export type CoachAudienceValue = "EXECUTIVE" | "STAFF";
export type CoachRehireIntentValue = "YES" | "CONDITIONAL" | "NO";
export type CoachEvaluationScoreKey = "practiceSupport" | "fieldOperation" | "communication" | "leading" | "punctuality";
export type CoachEvaluationScores = Record<CoachEvaluationScoreKey, number | null>;

export const COACH_ENGAGEMENT_ROLES: ReadonlyArray<{ value: CoachEngagementRoleValue; label: string }> = [
  { value: "PRACTICE_COACH", label: "실습코치" },
  { value: "LEAD", label: "리드" },
  { value: "OPERATION_ASSISTANT", label: "운영조교" }
];
export const COACH_PRACTICE_DIFFICULTIES: ReadonlyArray<CoachPracticeDifficultyValue> = ["A", "B", "C"];
export const COACH_AUDIENCES: ReadonlyArray<{ value: CoachAudienceValue; label: string }> = [
  { value: "STAFF", label: "실무자" },
  { value: "EXECUTIVE", label: "임원" }
];
export const COACH_REHIRE_INTENTS: ReadonlyArray<{ value: CoachRehireIntentValue; label: string }> = [
  { value: "YES", label: "예" },
  { value: "CONDITIONAL", label: "조건부" },
  { value: "NO", label: "아니오" }
];

export interface CoachEvaluationScoreItem {
  key: CoachEvaluationScoreKey;
  label: string;
  roles: ReadonlyArray<CoachEngagementRoleValue>;
  max: number;
  /** 시간 준수는 최고 4점이라 평균에서 뺀다. 지각·이탈은 사실 기록으로 따로 남긴다. */
  inAverage: boolean;
}

const ALL_ROLES: ReadonlyArray<CoachEngagementRoleValue> = ["PRACTICE_COACH", "LEAD", "OPERATION_ASSISTANT"];
export const COACH_EVALUATION_SCORE_ITEMS: ReadonlyArray<CoachEvaluationScoreItem> = [
  { key: "practiceSupport", label: "실습 대응", roles: ["PRACTICE_COACH", "LEAD"], max: 5, inAverage: true },
  { key: "fieldOperation", label: "현장 운영", roles: ALL_ROLES, max: 5, inAverage: true },
  { key: "communication", label: "소통", roles: ALL_ROLES, max: 5, inAverage: true },
  { key: "leading", label: "리딩", roles: ["LEAD"], max: 5, inAverage: true },
  { key: "punctuality", label: "시간 준수", roles: ALL_ROLES, max: 4, inAverage: false }
];
/** 4점이 기본값이다. */
export const COACH_EVALUATION_DEFAULT_SCORE = 4;
export const COACH_EVALUATION_TEXT_MAX = 2000;
export const COACH_REHIRE_REASON_MAX = 500;

export function scoreItemsForRole(role: CoachEngagementRoleValue): CoachEvaluationScoreItem[] {
  return COACH_EVALUATION_SCORE_ITEMS.filter((item) => item.roles.includes(role));
}

/** 5점이나 3점 이하가 하나라도 있으면 근거가 필요하다. */
export function evidenceRequired(role: CoachEngagementRoleValue, scores: Partial<CoachEvaluationScores>): boolean {
  return scoreItemsForRole(role).some((item) => {
    const score = scores[item.key];
    return typeof score === "number" && (score === 5 || score <= 3);
  });
}

/** 평균에 들어가는 항목의 평균. 해당 항목 점수가 없으면 null. */
export function evaluationAverage(role: CoachEngagementRoleValue, scores: Partial<CoachEvaluationScores>): number | null {
  const values = scoreItemsForRole(role)
    .filter((item) => item.inAverage)
    .map((item) => scores[item.key])
    .filter((score): score is number => typeof score === "number");
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, score) => sum + score, 0) / values.length) * 100) / 100;
}

/** 저장된 평가의 평균. 역할에 해당하지 않는 항목은 비어 있으므로 역할 없이 계산할 수 있다. */
export function storedEvaluationAverage(scores: Partial<CoachEvaluationScores>): number | null {
  const values = COACH_EVALUATION_SCORE_ITEMS.filter((item) => item.inAverage)
    .map((item) => scores[item.key])
    .filter((score): score is number => typeof score === "number");
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, score) => sum + score, 0) / values.length) * 100) / 100;
}

export interface CoachEngagementDetailInput {
  role: CoachEngagementRoleValue;
  practiceDifficulty: CoachPracticeDifficultyValue | null;
  audience: CoachAudienceValue | null;
  isNewClient: boolean | null;
}

export interface CoachOmEvaluationInput {
  detail: CoachEngagementDetailInput;
  scores: CoachEvaluationScores;
  rehire: CoachRehireIntentValue;
  rehireReason: string | null;
  evidence: string | null;
}

export type CoachEvaluationValidation = { ok: true; value: CoachOmEvaluationInput } | { ok: false; error: string };

function pick<T extends string>(value: unknown, allowed: ReadonlyArray<T>): T | null {
  return typeof value === "string" && (allowed as ReadonlyArray<string>).includes(value) ? (value as T) : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** 화면에서 받은 값을 검증하고 정규화한다. 역할에 해당하지 않는 항목 점수는 버린다. */
export function validateOmEvaluationInput(body: unknown): CoachEvaluationValidation {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const role = pick(input.role, ALL_ROLES);
  if (!role) return { ok: false, error: "이번 과정 역할을 골라 주세요." };

  const rawScores = (input.scores && typeof input.scores === "object" ? input.scores : {}) as Record<string, unknown>;
  const scores: CoachEvaluationScores = { practiceSupport: null, fieldOperation: null, communication: null, leading: null, punctuality: null };
  for (const item of scoreItemsForRole(role)) {
    const score = rawScores[item.key];
    if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > item.max) {
      return { ok: false, error: `${item.label} 점수를 골라 주세요.` };
    }
    scores[item.key] = score;
  }

  const evidence = text(input.evidence);
  if (evidence && evidence.length > COACH_EVALUATION_TEXT_MAX) return { ok: false, error: "근거가 너무 길어요." };
  if (!evidence && evidenceRequired(role, scores)) {
    return { ok: false, error: "5점이나 3점 이하 점수가 있으면 근거를 적어 주세요." };
  }

  const rehire = pick(input.rehire, COACH_REHIRE_INTENTS.map((option) => option.value));
  if (!rehire) return { ok: false, error: "재투입 의향을 골라 주세요." };
  const rehireReason = text(input.rehireReason);
  if (rehireReason && rehireReason.length > COACH_REHIRE_REASON_MAX) return { ok: false, error: "재투입 의향 사유가 너무 길어요." };
  if (rehire !== "YES" && !rehireReason) return { ok: false, error: "조건부·아니오는 사유를 적어 주세요." };

  return {
    ok: true,
    value: {
      detail: {
        role,
        practiceDifficulty: pick(input.practiceDifficulty, COACH_PRACTICE_DIFFICULTIES),
        audience: pick(input.audience, COACH_AUDIENCES.map((option) => option.value)),
        isNewClient: typeof input.isNewClient === "boolean" ? input.isNewClient : null
      },
      scores,
      rehire,
      rehireReason: rehire === "YES" ? null : rehireReason,
      evidence
    }
  };
}

// --- 권한 ---------------------------------------------------------------------

/** 정책 담당자(평가 수정·삭제 권한). Coolify env COACH_POLICY_OWNER_EMAILS, 쉼표 구분. */
export function coachPolicyOwnerEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.COACH_POLICY_OWNER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export interface CoachEvaluationViewer {
  email: string;
  /** 팀원 명단의 이름(운영현황 담당 OM과 맞춰 본다). */
  names: ReadonlyArray<string>;
  /** 팀원 명단의 역할(om·ld). */
  roles: ReadonlyArray<"om" | "ld">;
  isPolicyOwner: boolean;
}

/** 평가 원문은 OM·LD와 정책 담당자만 본다. */
export function canViewCoachEvaluations(viewer: CoachEvaluationViewer): boolean {
  return viewer.isPolicyOwner || viewer.roles.length > 0;
}

/** 수정·삭제는 평가를 쓴 사람과 정책 담당자만 한다. */
export function canEditCoachEvaluation(viewer: CoachEvaluationViewer, evaluatorEmail: string): boolean {
  return viewer.isPolicyOwner || evaluatorEmail.trim().toLowerCase() === viewer.email.trim().toLowerCase();
}

/** 평가는 과정이 끝난 투입에만 쓴다. today·endDate는 YYYY-MM-DD. */
export function isEngagementEvaluable(endDate: string, today: string): boolean {
  return endDate <= today;
}

// --- 사실 기록 (정책 "평가·등급" 1·2절: 지각·무단 불참·공식 불만 등은 점수와 따로 남긴다) ---

export type CoachFactKindValue = "LATE" | "NO_SHOW" | "FORMAL_COMPLAINT" | "LEFT_POST" | "PREP_MISSING" | "SERIOUS_VIOLATION";
export const COACH_FACT_KINDS: ReadonlyArray<{ value: CoachFactKindValue; label: string }> = [
  { value: "LATE", label: "지각" },
  { value: "NO_SHOW", label: "무단 불참" },
  { value: "LEFT_POST", label: "말없이 자리 이탈" },
  { value: "PREP_MISSING", label: "준비 미흡" },
  { value: "FORMAL_COMPLAINT", label: "공식 불만(강사·고객사)" },
  { value: "SERIOUS_VIOLATION", label: "중대 위반" }
];

export interface CoachFactRecordInput {
  kind: CoachFactKindValue;
  occurredOn: string;
  description: string;
}

export type CoachFactValidation = { ok: true; value: CoachFactRecordInput } | { ok: false; error: string };

/** 발생일은 그 투입 기간 안이고 오늘 이후가 아니어야 한다. 날짜는 YYYY-MM-DD. */
export function validateFactRecordInput(body: unknown, engagement: { startDate: string; endDate: string }, today: string): CoachFactValidation {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const kind = pick(input.kind, COACH_FACT_KINDS.map((option) => option.value));
  if (!kind) return { ok: false, error: "무슨 일이 있었는지 종류를 골라 주세요." };
  const occurredOn = typeof input.occurredOn === "string" ? input.occurredOn.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || Number.isNaN(Date.parse(`${occurredOn}T00:00:00Z`))) {
    return { ok: false, error: "발생일을 골라 주세요." };
  }
  if (occurredOn < engagement.startDate || occurredOn > engagement.endDate) return { ok: false, error: "발생일은 이 투입 기간 안이어야 해요." };
  if (occurredOn > today) return { ok: false, error: "아직 오지 않은 날짜는 기록할 수 없어요." };
  const description = text(input.description);
  if (!description) return { ok: false, error: "상황을 적어 주세요(시간·장소·무슨 일이 있었는지)." };
  if (description.length > COACH_EVALUATION_TEXT_MAX) return { ok: false, error: "내용이 너무 길어요." };
  return { ok: true, value: { kind, occurredOn, description } };
}
