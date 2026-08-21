// 운영현황 저장소를 감싸 구글 캘린더 반영을 붙인다.
//
// 라우트별로 훅을 거는 대신 저장소를 감싼 이유: 쓰기 경로가 운영 생성 API, 차수 추가,
// 드라이브 임포트 적용, om-request 연동, 만족도 반영으로 흩어져 있어 라우트마다 걸면
// 반드시 빠지는 곳이 생긴다. 저장소 한 곳을 감싸면 모든 경로가 자동으로 덮인다.

import type { OperationRepository } from "./operationRepository";
import type {
  CreateOperationInput,
  OperationSession,
  OperationSummary,
  UpdateOperationInput
} from "./operationTypes";
import {
  reflectOperationCreated,
  reflectOperationDelete,
  reflectOperationUpdated
} from "@/lib/googleCalendar/reflectOperationToCalendar";

// 캘린더 이벤트에 드러나는 값만 추린다. 만족도·비용처럼 일정과 무관한 수정에는
// 구글을 호출하지 않아 불필요한 초대 메일 재발송을 막는다.
const CALENDAR_RELEVANT_FIELDS: Array<keyof UpdateOperationInput> = [
  "startDate",
  "endDate",
  "timeText",
  "region",
  "om",
  "onsiteOm",
  "courseName"
];

function touchesCalendar(input: UpdateOperationInput): boolean {
  return CALENDAR_RELEVANT_FIELDS.some((field) => input[field] !== undefined);
}

export class CalendarReflectingOperationRepository implements OperationRepository {
  constructor(private readonly inner: OperationRepository) {}

  listOperations(): Promise<OperationSession[]> {
    return this.inner.listOperations();
  }

  getOperationById(operationId: string): Promise<OperationSession | null> {
    return this.inner.getOperationById(operationId);
  }

  getSummary(): Promise<OperationSummary> {
    return this.inner.getSummary();
  }

  async createOperation(input: CreateOperationInput): Promise<OperationSession> {
    const operation = await this.inner.createOperation(input);
    await reflectOperationCreated(operation);
    return operation;
  }

  async updateOperation(operationId: string, input: UpdateOperationInput): Promise<OperationSession> {
    const operation = await this.inner.updateOperation(operationId, input);
    if (touchesCalendar(input)) await reflectOperationUpdated(operation);
    return operation;
  }

  async deleteOperation(operationId: string, deletedBy?: string): Promise<void> {
    await this.inner.deleteOperation(operationId, deletedBy);
    await reflectOperationDelete(operationId);
  }
}
