import type {
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
  getOperationById(operationId: string): Promise<OperationSession | null>;
  createOperation(input: CreateOperationInput): Promise<OperationSession>;
  updateOperation(operationId: string, input: UpdateOperationInput): Promise<OperationSession>;
  deleteOperation(operationId: string, deletedBy?: string): Promise<void>;
  getSummary(): Promise<OperationSummary>;
}
