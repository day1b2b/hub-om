import { companyNameError } from "./companyName";
import { normalizeVisibleText } from "./operationRowMapping";
import { getOperationRepository } from "./operationRepositoryFactory";
import { syncCompanyByOperationId } from "./omRequest/omRequestLocalRepository";
import type { OperationSession } from "./operationTypes";

export class CourseCompanyChangeError extends Error {
  readonly code: "INVALID_NAME" | "NOT_FOUND" | "COURSE_EXISTS";
  constructor(code: CourseCompanyChangeError["code"], message: string) {
    super(message);
    this.name = "CourseCompanyChangeError";
    this.code = code;
  }
}

/**
 * 과정의 기업을 바꾼다. 기업명은 운영 상세 제목·기업위키·업무 요청 세 곳이 같이 보여주므로 한 번에 맞춘다.
 * - 과정(Course) 행이 옮겨 가므로 같은 과정의 모든 회차가 같이 움직인다(과정ID·공통 메모 유지).
 * - 나머지 회차도 차례로 저장해 회차별 캘린더 제목("[기업] 과정_N회차")이 따라가게 한다.
 * - 회차에 연결된 업무 요청(om-request)의 기업명도 같이 바꾼다.
 */
export async function changeCourseCompany(operationId: string, rawCompanyName: string, updatedBy?: string): Promise<OperationSession> {
  const nameError = companyNameError(rawCompanyName);
  if (nameError) throw new CourseCompanyChangeError("INVALID_NAME", nameError);
  const companyName = normalizeVisibleText(rawCompanyName);

  const repository = getOperationRepository();
  const operation = await repository.getOperationById(operationId);
  if (!operation) throw new CourseCompanyChangeError("NOT_FOUND", "회차를 찾을 수 없습니다.");

  const siblings = operation.courseRecordId
    ? (await repository.listOperations()).filter((candidate) => candidate.courseRecordId === operation.courseRecordId)
    : [operation];

  let updated: OperationSession;
  try {
    updated = await repository.updateOperation(operationId, { companyName }, updatedBy);
  } catch (error) {
    if (error instanceof Error && /COMPANY_ALREADY_HAS_COURSE|Company already has the same course/.test(error.message)) {
      throw new CourseCompanyChangeError("COURSE_EXISTS", "옮길 기업에 같은 코스ID·과정명의 과정이 이미 있습니다. 과정명을 먼저 구분해 주세요.");
    }
    throw error;
  }

  for (const sibling of siblings) {
    if (sibling.operationId !== operationId) await repository.updateOperation(sibling.operationId, { companyName }, updatedBy);
  }
  for (const sibling of siblings) await syncCompanyByOperationId(sibling.operationId, companyName);

  return updated;
}
