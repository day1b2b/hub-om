import type {
  CoachAudienceValue,
  CoachEngagementRoleValue,
  CoachEvaluationScores,
  CoachOmEvaluationInput,
  CoachPracticeDifficultyValue,
  CoachRehireIntentValue
} from "@/lib/coaches/coachEvaluationRules";

/** 평가 대상 투입의 최소 정보. 날짜는 YYYY-MM-DD. */
export interface CoachEvaluationEngagementRef {
  id: string;
  coachId: string;
  courseName: string;
  startDate: string;
  endDate: string;
}

export interface CoachEngagementDetailRecord {
  engagementId: string;
  role: CoachEngagementRoleValue;
  practiceDifficulty: CoachPracticeDifficultyValue | null;
  audience: CoachAudienceValue | null;
  isNewClient: boolean | null;
  updatedAt: Date;
}

/** 이번 PR은 OM 평가만 쓴다. 리드·강사 출처는 나중에 붙인다. */
export interface CoachEvaluationRecord {
  id: string;
  coachId: string;
  engagementId: string | null;
  source: "OM";
  courseName: string;
  startDate: string;
  endDate: string;
  scores: CoachEvaluationScores;
  rehire: CoachRehireIntentValue;
  rehireReason: string | null;
  evidence: string | null;
  evaluatorEmail: string;
  evaluatorName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CoachEvaluationActor {
  email: string;
  name: string | null;
}

/** 목록의 최근 평균 계산용. 삭제되지 않은 OM 평가만. */
export interface CoachEvaluationAverageInput {
  coachId: string;
  engagementId: string | null;
  scores: CoachEvaluationScores;
}

export type CoachEvaluationErrorCode = "ENGAGEMENT_NOT_FOUND" | "ALREADY_EVALUATED" | "EVALUATION_NOT_FOUND";

export class CoachEvaluationError extends Error {
  readonly code: CoachEvaluationErrorCode;
  constructor(code: CoachEvaluationErrorCode) {
    super(code);
    this.name = "CoachEvaluationError";
    this.code = code;
  }
}

/**
 * 권한·검증은 API에서 한다. 저장소는 아래를 보장한다.
 * - 투입은 그 코치의 것이어야 한다(아니면 ENGAGEMENT_NOT_FOUND).
 * - 투입 1건 × OM 출처당 삭제되지 않은 평가는 1개(ALREADY_EVALUATED). 삭제 후 다시 쓸 수 있다.
 * - 평가에는 과정명·기간을 함께 남긴다(삼성 일정 동기화가 투입을 지우고 다시 만들기 때문).
 * - 역할 등 투입 정보(CoachEngagementDetail)는 평가 저장과 같은 트랜잭션에서 덮어쓴다.
 * - 삭제는 소프트 삭제(deletedAt·deletedBy).
 */
export interface CoachEvaluationRepository {
  getEngagement(coachId: string, engagementId: string): Promise<CoachEvaluationEngagementRef | null>;
  listForCoach(coachId: string): Promise<{ evaluations: CoachEvaluationRecord[]; details: CoachEngagementDetailRecord[] }>;
  getEvaluation(coachId: string, evaluationId: string): Promise<CoachEvaluationRecord | null>;
  createOmEvaluation(coachId: string, engagementId: string, input: CoachOmEvaluationInput, actor: CoachEvaluationActor): Promise<CoachEvaluationRecord>;
  updateOmEvaluation(coachId: string, evaluationId: string, input: CoachOmEvaluationInput, actor: CoachEvaluationActor): Promise<CoachEvaluationRecord>;
  deleteEvaluation(coachId: string, evaluationId: string, actor: CoachEvaluationActor): Promise<void>;
  listOmAverageInputs(): Promise<CoachEvaluationAverageInput[]>;
}
