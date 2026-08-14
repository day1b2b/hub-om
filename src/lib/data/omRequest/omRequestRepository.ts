// om-request 저장소 계약. 로컬(dev)은 .local 파일, 배포는 PostgreSQL을 쓰지만
// 화면/API는 이 인터페이스만 본다 (operationRepository/instructorNoteRepository와 동일한 관례).
import type { OmRequest, OmRequestInput } from "./omRequestTypes";

export interface OmRequestRepository {
  listOmRequests(): Promise<OmRequest[]>;
  getOmRequest(id: string): Promise<OmRequest | null>;
  createOmRequest(input: OmRequestInput): Promise<OmRequest>;
  updateOmRequest(id: string, input: OmRequestInput): Promise<OmRequest | null>;
  deleteOmRequest(id: string): Promise<boolean>;
  updateOmRequestAssignment(id: string, assignedOm: string | null): Promise<OmRequest | null>;
  /** 자동 연결 서비스가 생성된 operationId를 채워 넣을 때 쓴다. */
  setOmRequestOperationId(id: string, operationId: string): Promise<void>;
}
