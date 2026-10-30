// 회차별 만족도 결과 저장소 계약. 라우트와 화면은 이 인터페이스만 보고,
// 백엔드(Postgres / Mongo shadow) 선택은 sessionSurveyResultRepositoryFactory가 맡는다.

import type { SessionSurveyResult, SessionSurveyResultInput } from "./sessionSurveyResultTypes";

export type { SessionSurveyResult, SessionSurveyResultInput };

export interface SessionSurveyResultRepository {
  /** 회차 업무 키 목록에 해당하는 결과. 결과가 없는 회차는 빠진다. */
  listByOperationIds(operationIds: readonly string[]): Promise<SessionSurveyResult[]>;
  /**
   * 회차 하나의 결과를 덮어쓴다(없으면 만든다). 누른 시점이 최종본이다.
   * input.comments가 undefined면 저장된 코멘트는 그대로 둔다.
   */
  upsert(input: SessionSurveyResultInput): Promise<SessionSurveyResult>;
}
