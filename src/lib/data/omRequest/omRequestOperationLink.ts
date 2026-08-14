import { getOperationRepository } from "../operationRepositoryFactory";
import type { CreateOperationInput } from "../operationTypes";
import type { OmRequest } from "./omRequestTypes";

const EDUCATION_FORMAT_BY_TRAINING_TYPE: Record<OmRequest["trainingType"], CreateOperationInput["educationFormat"]> = {
  "오프라인": "오프라인",
  "블렌디드": "블렌디드",
  "비대면": "비대면",
  "해커톤": "검토필요"
};

function timeTextOf(session: OmRequest["sessions"][number]): string {
  return session.timeStart && session.timeEnd ? `${session.timeStart} ~ ${session.timeEnd}` : "";
}

/**
 * om-request 접수 시점에 courseId 없이 Course/OperationSession을 자동 생성해
 * 운영현황에서 바로 확인/수정할 수 있게 연결한다. 코스ID는 요청 시점에 확정되지
 * 않는다는 기존 데이터 정책(docs/operations/data-model-draft.md)을 그대로 따른다.
 *
 * om-request의 회차(sessions)마다 별도 OperationSession(차수)을 만든다 —
 * "차수 추가"(/api/operations/[operationId]/rounds)가 courseId/courseName/companyName은
 * 그대로 두고 roundNo/날짜만 바꿔 createOperation()을 다시 부르는 것과 같은 방식이다.
 * 같은 course upsert key(companyId+courseId+courseName)로 묶이므로 한 과정 아래 회차가 모인다.
 *
 * 실패해도 om-request 접수 자체를 막으면 안 되므로, 호출부에서 best-effort로 감싸서 쓴다.
 * 반환하는 operationId는 첫 회차(1차수)를 대표로 가리킨다.
 */
export async function createLinkedOperationForOmRequest(request: OmRequest): Promise<string | null> {
  const sessions = request.sessions.filter((session) => session.date);
  if (sessions.length === 0) return null;

  const repository = getOperationRepository();
  let firstOperationId: string | null = null;

  for (const [index, session] of sessions.entries()) {
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
      educationDays: session.duration || "",
      educationFormat: EDUCATION_FORMAT_BY_TRAINING_TYPE[request.trainingType],
      endDate: session.dateEnd || session.date,
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
      region: session.location || "",
      resultReportLink: "",
      revenue: null,
      roundNo: String(index + 1),
      specialNotes: "",
      startDate: session.date,
      timeText: timeTextOf(session),
      totalCost: null
    };

    const operation = await repository.createOperation(input);
    if (!firstOperationId) firstOperationId = operation.operationId;
  }

  return firstOperationId;
}

/** 배정 완료 시 운영현황의 OM 값을 동기화한다. 실패해도 배정 자체는 막지 않는다. */
export async function syncAssignedOmToLinkedOperation(operationId: string, assignedOm: string): Promise<void> {
  await getOperationRepository().updateOperation(operationId, { om: assignedOm });
}
