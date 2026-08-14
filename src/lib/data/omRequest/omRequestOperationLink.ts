import { getOperationRepository } from "../operationRepositoryFactory";
import type { CreateOperationInput } from "../operationTypes";
import type { OmRequest } from "./omRequestTypes";

const EDUCATION_FORMAT_BY_TRAINING_TYPE: Record<OmRequest["trainingType"], CreateOperationInput["educationFormat"]> = {
  "오프라인": "오프라인",
  "블렌디드": "블렌디드",
  "비대면": "비대면",
  "해커톤": "검토필요"
};

function deriveDateRange(request: OmRequest): { startDate: string; endDate: string } | null {
  const dates = request.sessions
    .flatMap((session) => [session.date, session.dateEnd || session.date])
    .filter((date): date is string => Boolean(date))
    .sort();

  if (dates.length === 0) return null;
  return { startDate: dates[0], endDate: dates[dates.length - 1] };
}

/**
 * om-request 접수 시점에 courseId 없이 Course/OperationSession을 자동 생성해
 * 운영현황에서 바로 확인/수정할 수 있게 연결한다. 코스ID는 요청 시점에 확정되지
 * 않는다는 기존 데이터 정책(docs/operations/data-model-draft.md)을 그대로 따른다.
 *
 * 실패해도 om-request 접수 자체를 막으면 안 되므로, 호출부에서 best-effort로 감싸서 쓴다.
 */
export async function createLinkedOperationForOmRequest(request: OmRequest): Promise<string | null> {
  const dateRange = deriveDateRange(request);
  if (!dateRange) return null;

  const input: CreateOperationInput = {
    archiveStatus: "아카이빙전",
    coach: "",
    companyName: request.company,
    companyWikiLink: "",
    costRaw: "",
    courseId: request.courseId,
    courseName: request.courseName,
    createdBy: request.ld,
    driveLink: request.driveLink,
    educationDays: "",
    educationFormat: EDUCATION_FORMAT_BY_TRAINING_TYPE[request.trainingType],
    endDate: dateRange.endDate,
    instructorCost: null,
    instructorWikiLink: "",
    instructors: request.instructorName,
    ld: request.ld,
    lectureManagementLink: "",
    om: request.assignedOm ?? "",
    onsiteRequired: request.onSiteOperation === "Y" ? "Y" : "N",
    operationCost: null,
    operationDetail: request.notes || `${request.courseName} - om-request로 접수된 건. 상세 내용 확인 필요`,
    operationIssue: "",
    operationStatus: "배정필요",
    operationType: "검토필요",
    padletLink: "",
    region: request.sessions[0]?.location ?? "",
    resultReportLink: "",
    revenue: null,
    roundNo: "",
    specialNotes: "",
    startDate: dateRange.startDate,
    timeText: "",
    totalCost: null
  };

  const operation = await getOperationRepository().createOperation(input);
  return operation.operationId;
}

/** 배정 완료 시 운영현황의 OM 값을 동기화한다. 실패해도 배정 자체는 막지 않는다. */
export async function syncAssignedOmToLinkedOperation(operationId: string, assignedOm: string): Promise<void> {
  await getOperationRepository().updateOperation(operationId, { om: assignedOm });
}
