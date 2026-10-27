import { getDataRepositoryOverride } from "../dataRepositoryContext";
import { ASSIGNMENT_NEEDED_VALUES, isSameCourse, parseEducationDatesText } from "../operationCalculations";
import { getOperationRepository } from "../operationRepositoryFactory";
import { syncAssignedOmByOperationId } from "./omRequestLocalRepository";
import type { CreateOperationInput } from "../operationTypes";
import type { OmRequest } from "./omRequestTypes";
import { sessionScheduleChanged, type SessionOrigin } from "./omRequestSessionPlan";
import type { notifyOmAssigned } from "../../slack/notifySlack";

const PLACEHOLDER_OM_VALUES = new Set(["", ...Array.from(ASSIGNMENT_NEEDED_VALUES)]);

function needsOmAssignment(om: string): boolean {
  return PLACEHOLDER_OM_VALUES.has(om.trim());
}

export const EDUCATION_FORMAT_BY_TRAINING_TYPE: Record<OmRequest["trainingType"], CreateOperationInput["educationFormat"]> = {
  "오프라인": "오프라인",
  "블렌디드": "블렌디드",
  "비대면": "비대면",
  "온라인": "온라인",
  "플립러닝": "플립러닝",
  "PBL": "PBL",
  "해커톤": "해커톤"
};

function timeTextOf(session: OmRequest["sessions"][number]): string {
  return session.timeStart && session.timeEnd ? `${session.timeStart} ~ ${session.timeEnd}` : "";
}

function operationInputForSession(request: OmRequest, session: OmRequest["sessions"][number], roundNo: string): CreateOperationInput {
  // 세션에 실제 교육일을 따로 적어뒀으면(예: 9/3, 9/4, 9/7) 그 값을 우선한다 — date~dateEnd는
  // 그 사이 모든 날짜가 교육일이라고 가정하지만, 중간에 쉬는 날이 있는 회차는 그 가정이 틀리다.
  const educationDates = session.educationDatesText
    ? parseEducationDatesText(session.educationDatesText).dates
    : undefined;

  return {
    archiveStatus: "아카이빙전",
    calendarPartKey: request.team,
    coach: "",
    companyName: request.company,
    companyWikiLink: "",
    costRaw: "",
    courseCategory: request.courseCategory,
    courseId: request.courseId,
    courseName: request.courseName,
    createdBy: request.ld,
    driveLink: request.driveLink,
    educationDays: session.duration || "",
    educationDates,
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
    operationDetail: "",
    operationIssue: "",
    operationStatus: "배정필요",
    operationType: "검토필요",
    padletLink: "",
    region: session.location || "",
    resultReportLink: "",
    revenue: null,
    roundNo,
    specialNotes: request.notes || `${request.courseName} - om-request로 접수된 건. 상세 내용 확인 필요`,
    startDate: session.date,
    timeText: timeTextOf(session),
    tools: request.tools ?? "",
    totalCost: null
  };
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
 *
 * 회차를 만들다 중간에 실패하면 이미 만든 회차를 지운다(숨김 처리 + 캘린더 일정 삭제).
 * 실패하면 요청에 operationId가 연결되지 않으므로, 앞 회차만 남기면 요청과 이어지지 않은
 * 운영현황 회차와 캘린더 일정이 생긴다. 교육일이 없는 회차를 건너뛰면 회차 번호가 요청과
 * 어긋나므로, 그런 입력은 만들기 전에 거절한다.
 */
export async function createLinkedOperationForOmRequest(request: OmRequest): Promise<string | null> {
  const sessions = request.sessions;
  if (sessions.length === 0) return null;
  if (sessions.length !== request.totalSessions || sessions.some((session) => !session.date?.trim())) {
    throw new Error("OM_REQUEST_SESSION_INPUT_INVALID");
  }

  const repository = getOperationRepository();
  const createdOperationIds = await createRoundsOrCleanUp(
    sessions.map((session, index) => operationInputForSession(request, session, String(index + 1))),
    request.ld
  );
  const firstOperationId = createdOperationIds[0] ?? null;

  // createOperation()은 결과보고서 여부를 항상 "확인필요"로 만든다 — om-request에서
  // "결과보고서: N"으로 접수됐으면(불필요) 별도 patch로 덮어써 운영현황과 값을 맞춘다.
  // /operations/new(OperationCreateForm)의 동일 패턴을 그대로 따른 것.
  if (request.resultReportNeeded === "N") {
    for (const operationId of createdOperationIds) {
      await repository.updateOperation(operationId, { hasResultReport: "불필요" });
    }
  }

  return firstOperationId;
}

/**
 * 회차를 순서대로 만든다. 하나라도 실패하면 이번에 만든 회차를 역순으로 지우고 원래 오류를 다시 던진다.
 * 지우다 실패해도 원래 오류를 가리지 않는다. 결과보고서 patch처럼 만든 뒤의 단계는 여기서 다루지 않는다.
 */
async function createRoundsOrCleanUp(inputs: CreateOperationInput[], deletedBy?: string): Promise<string[]> {
  const repository = getOperationRepository();
  const createdOperationIds: string[] = [];
  try {
    for (const input of inputs) createdOperationIds.push((await repository.createOperation(input)).operationId);
  } catch (error) {
    for (const operationId of [...createdOperationIds].reverse()) {
      try { await repository.deleteOperation(operationId, deletedBy); } catch { /* 원래 실패를 그대로 알린다 */ }
    }
    throw error;
  }
  return createdOperationIds;
}

/**
 * 업무 요청 수정에서 회차를 늘리거나 줄이거나 일정을 바꾼 결과를 운영현황 회차에 맞춘다.
 *
 * 남은 회차 중 교육일·시간·장소가 바뀐 회차는 운영현황 회차의 같은 값을 고친다. 요청에서
 * 바뀌지 않은 회차는 건드리지 않아 운영현황에서 따로 고친 값을 덮어쓰지 않는다.
 *
 * 요청의 회차 하나가 운영현황 회차(OperationSession) 하나다. 지운 회차는 운영현황
 * 삭제(deleteOperation, 숨김 처리)로, 추가한 회차는 새 회차 생성으로 반영하고, 남은 회차는
 * 화면 순서대로 1..N을 다시 매긴다 — 운영현황 회차 삭제(api/operations/[operationId])와 같은
 * 규칙이다. 구글 캘린더 일정은 저장소의 생성/삭제/수정 반영으로 함께 따라간다.
 *
 * 운영현황 쪽 회차 수가 요청과 다르면(운영현황에서 따로 추가/삭제한 경우) 어느 회차가
 * 어느 회차인지 짐작하지 않고 OPERATION_ROUND_MISMATCH로 거절한다.
 * 반환값은 바뀐 대표 회차(1회차) operationId다.
 */
export async function syncOmRequestSessionsToOperations(
  existing: OmRequest,
  next: OmRequest,
  origins: SessionOrigin[],
  actorEmail?: string
): Promise<string> {
  if (!existing.operationId) throw new Error("OPERATION_ROUND_MISMATCH");
  const repository = getOperationRepository();
  const representative = await repository.getOperationById(existing.operationId);
  if (!representative) throw new Error("OPERATION_ROUND_MISMATCH");

  const rounds = (await repository.listOperations())
    .filter((candidate) =>
      representative.courseRecordId ? candidate.courseRecordId === representative.courseRecordId : isSameCourse(candidate, representative)
    )
    .sort((a, b) => Number(a.roundNo) - Number(b.roundNo));
  if (rounds.length !== existing.sessions.length || existing.sessions.some((session) => !session.date)) {
    throw new Error("OPERATION_ROUND_MISMATCH");
  }

  // 1) 새 회차를 먼저 만든다 — 생성이 실패하면 이번에 만든 회차를 지우고, 기존 회차는 건드리지 않은 채 멈춘다.
  const addedIndexes = origins.flatMap((origin, index) => (origin === null ? [index] : []));
  const created = await createRoundsOrCleanUp(
    addedIndexes.map((index) => operationInputForSession(next, next.sessions[index], String(index + 1))),
    actorEmail
  );
  const createdByIndex = new Map(addedIndexes.map((index, position) => [index, created[position]]));
  const ordered: { operationId: string; roundNo: string }[] = origins.map((origin, index) =>
    origin !== null ? rounds[origin] : { operationId: createdByIndex.get(index)!, roundNo: String(index + 1) }
  );
  if (next.resultReportNeeded === "N") {
    for (const operationId of created) await repository.updateOperation(operationId, { hasResultReport: "불필요" });
  }

  // 2) 남은 회차 중 일정이 바뀐 회차를 운영현황에도 고친다(캘린더는 수정 반영으로 따라간다).
  for (const [index, origin] of origins.entries()) {
    if (origin === null || !sessionScheduleChanged(existing.sessions[origin], next.sessions[index])) continue;
    const { educationDates, educationDays, endDate, region, startDate, timeText } = operationInputForSession(next, next.sessions[index], "");
    await repository.updateOperation(rounds[origin].operationId, { educationDates: educationDates ?? [], educationDays, endDate, region, startDate, timeText });
  }

  // 3) 화면에서 고른 회차를 지운다(숨김 처리 + 캘린더 일정 삭제).
  const keptIds = new Set(ordered.map((round) => round.operationId));
  for (const round of rounds) {
    if (!keptIds.has(round.operationId)) await repository.deleteOperation(round.operationId, actorEmail);
  }

  // 4) 남은 회차 번호를 화면 순서대로 1..N으로 맞춘다.
  for (const [index, round] of ordered.entries()) {
    const roundNo = String(index + 1);
    if (round.roundNo.trim() !== roundNo) await repository.updateOperation(round.operationId, { roundNo });
  }

  return ordered[0].operationId;
}

/**
 * 배정 완료 시 운영현황의 OM 값을 동기화한다. 실패해도 배정 자체는 막지 않는다.
 *
 * operationStatus는 om-request 자동 생성 시점(createLinkedOperationForOmRequest)에
 * "배정필요"로 고정되고 이후 어디서도 재계산되지 않아서, OM을 나중에 배정해도
 * 대시보드 등 화면에는 계속 "배정필요"로 남아있던 문제(2026-08-19 제보)가 있었다.
 * 아직 "배정필요" 단계인 건에 한해서만 "배정예정"으로 한 단계 진행시키고,
 * 다른 경로(관리자 DB 편집 등)로 이미 상태가 더 진행된 건은 되돌리지 않는다.
 *
 * createLinkedOperationForOmRequest는 om-request의 회차마다 별도 OperationSession을
 * 만드는데, 이 함수는 그중 대표 회차(operationId, 보통 1회차) 하나만 갱신했다. 그래서
 * 같은 요청으로 같이 생성된 나머지 회차는 OM이 계속 비어있는("배정필요") 채로 남아
 * 관리자가 회차별로 수동 보정해야 하는 문제(2026-09-18 제보)가 있었다. 같은 과정
 * (courseId+courseName+companyName)의 회차 중 아직 OM이 비어있거나 플레이스홀더인
 * 회차에도 함께 반영해서, 이미 다른 값으로 개별 지정된 회차는 건드리지 않는다.
 */
export async function syncAssignedOmToLinkedOperation(operationId: string, assignedOm: string): Promise<void> {
  if (getDataRepositoryOverride("operations")) throw new Error("OM_ASSIGNMENT_MONGO_NOT_IMPLEMENTED");
  const repository = getOperationRepository();
  const operation = await repository.getOperationById(operationId);
  if (!operation) return;

  const allOperations = await repository.listOperations();
  const sameCourseOperations = allOperations.filter(
    (candidate) => candidate.operationId === operationId || isSameCourse(candidate, operation)
  );

  await Promise.all(
    sameCourseOperations
      .filter((candidate) => candidate.operationId === operationId || needsOmAssignment(candidate.om))
      .map((candidate) => {
        const nextStatus = candidate.operationStatus === "배정필요" ? "배정예정" : undefined;
        return repository.updateOperation(candidate.operationId, {
          om: assignedOm,
          ...(nextStatus ? { operationStatus: nextStatus } : {})
        });
      })
  );
}

export async function syncLinkedOmRequestAssignment(
  operationId: string,
  assignedOm: string | null,
  previousOm: string | null,
  notify?: typeof notifyOmAssigned
): Promise<"sent" | "sent-without-thread" | "failed" | "not-needed"> {
  const updated = await syncAssignedOmByOperationId(operationId, assignedOm);
  const nextOm = assignedOm?.trim() || null;
  if (!updated || !nextOm || needsOmAssignment(nextOm) || nextOm === (previousOm?.trim() || null)) return "not-needed";
  try {
    const send = notify ?? (await import("../../slack/notifySlack")).notifyOmAssigned;
    const delivered = await send({ company: updated.company, courseName: updated.courseName, assignedOm: nextOm,
      ld: updated.ld, ldEmail: updated.ldEmail, channel: updated.slackChannel, threadTs: updated.slackThreadTs });
    return delivered === "channel" ? "sent-without-thread" : "sent";
  } catch {
    console.error("[om-request] OM_ASSIGNMENT_NOTIFICATION_FAILED");
    return "failed";
  }
}
