import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";

/** 살아있는 운영 판단에 필요한 최소 필드. */
interface LiveOperation {
  operationId: string;
  courseId?: null | string;
}

/**
 * 운영 현황에서 지워진 과정의 담당 과정(업무요청)을 걷어낸다.
 *
 * 운영 현황에서 과정을 지우면 그 회차는 목록에서 사라진다(soft delete). 그런데 접수 때
 * 만들어진 업무요청은 그대로 남아서, 내 대시보드의 담당 과정 표·캘린더·사전세팅·D-day에
 * 계속 떠 있었다. 운영 현황에는 없는 과정이 내 대시보드에만 있는 상태가 된다.
 *
 * 남길지는 운영 현황과의 연결로 판단한다
 *   1. operationId가 없다 — 아직 운영이 만들어지지 않은 접수 건이다. 남긴다.
 *   2. operationId가 살아있는 운영에 있다 — 정상. 남긴다.
 *   3. 코스ID가 살아있는 운영에 있다 — 운영이 다시 만들어졌거나 다른 회차가 살아 있다. 남긴다.
 *   4. 그 외 — 연결됐던 운영이 지워졌다. 걷어낸다.
 *
 * 걷어낸 요청도 담당 관리 화면에는 그대로 남는다. 여기서 감추는 것은 "운영 현황이
 * 진실의 원천"이라는 기준을 내 대시보드에 맞추는 것이고, 요청 자체를 지우지는 않는다.
 */
export function dropRequestsWithDeletedOperation(
  requests: ReadonlyArray<OmRequest>,
  liveOperations: ReadonlyArray<LiveOperation>
): OmRequest[] {
  const liveOperationIds = new Set(
    liveOperations.map((operation) => operation.operationId.trim()).filter(Boolean)
  );
  // 빈 코스ID는 키로 쓰지 않는다. ""가 들어가면 코스ID 없는 요청이 전부 살아남아
  // 걷어내는 의미가 없어진다.
  const liveCourseIds = new Set(
    liveOperations.map((operation) => (operation.courseId ?? "").trim()).filter(Boolean)
  );

  return requests.filter((request) => {
    const operationId = (request.operationId ?? "").trim();
    if (!operationId) return true; // 아직 운영이 없는 접수 건
    if (liveOperationIds.has(operationId)) return true;

    const courseId = (request.courseId ?? "").trim();
    return courseId !== "" && liveCourseIds.has(courseId);
  });
}
