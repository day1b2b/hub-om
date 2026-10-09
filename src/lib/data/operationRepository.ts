import type {
  CourseCommonNote,
  CourseCommonNoteInput,
  CourseLookupCandidate,
  CreateOperationInput,
  OperationSession,
  OperationSummary,
  UpdateOperationInput
} from "./operationTypes";

export interface OperationRepository {
  listOperations(): Promise<OperationSession[]>;
  /** 코스ID로 과정을 찾는다(제로폭 문자·공백 차이는 무시). 최근 회차가 있는 과정이 앞에 온다. */
  findCoursesByCourseId(courseId: string): Promise<CourseLookupCandidate[]>;
  /**
   * 고객사명(+선택적으로 과정명 조각)으로 과정을 찾는다 — 코스ID를 모를 때 쓰는 역방향 조회.
   * 최근 회차가 있는 과정이 앞에 오고, `limit`보다 하나 더 돌려준다(호출자가 '더 있음'을 판단).
   */
  findCoursesByCompany(companyQuery: string, courseQuery: string, limit: number): Promise<CourseLookupCandidate[]>;
  getOperationById(operationId: string): Promise<OperationSession | null>;
  /** 생성 시각(DB `created_at`). 로컬 JSON 저장소처럼 추적하지 않는 백엔드는 null. */
  getOperationCreatedAt(operationId: string): Promise<Date | null>;
  upsertCourseCommonNote(courseRecordId: string, input: CourseCommonNoteInput, actorEmail?: string): Promise<CourseCommonNote>;
  deleteCourseCommonNote(courseRecordId: string, actorEmail?: string): Promise<void>;
  createOperation(input: CreateOperationInput): Promise<OperationSession>;
  /** updatedBy는 수정한 사람의 이메일. deleteOperation의 deletedBy와 같은 감사 기록용이다. */
  updateOperation(operationId: string, input: UpdateOperationInput, updatedBy?: string): Promise<OperationSession>;
  deleteOperation(operationId: string, deletedBy?: string): Promise<void>;
  getSummary(): Promise<OperationSummary>;
}
