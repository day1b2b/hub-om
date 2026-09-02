import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";

/**
 * 담당 과정(요청)과 운영 현황은 같은 과정을 양쪽에서 들고 있다.
 * 내 대시보드의 캘린더·사전세팅에서 같은 과정이 두 번 뜨지 않도록,
 * "이 운영은 담당 과정이 이미 대표하고 있는가"를 판단한다.
 *
 * 짝을 맞추는 순서
 *   1. operationId — 요청 접수 때 자동 생성한 운영을 가리킨다. 코스ID가 없어도 정확하다.
 *   2. courseId — 나중에 코스ID가 채워져 운영이 따로 만들어진 경우를 잡는다.
 *
 * 코스ID는 비어 있을 수 있으므로 빈 값은 짝짓기에 쓰지 않는다.
 * ""를 키로 쓰면 코스ID가 비어 있는 운영이 전부 "이미 표시됨"으로 걸러져
 * 캘린더와 사전세팅에서 통째로 사라진다(상단 요약만 남아 숫자가 어긋난다).
 */
export function createRequestMatcher(requests: ReadonlyArray<OmRequest>) {
  const operationIds = new Set(
    requests.map((request) => (request.operationId ?? "").trim()).filter(Boolean)
  );
  const courseIds = new Set(
    requests.map((request) => (request.courseId ?? "").trim()).filter(Boolean)
  );

  return function isRepresentedByRequest(operation: {
    courseId?: null | string;
    operationId: string;
  }): boolean {
    if (operationIds.has(operation.operationId.trim())) return true;
    const courseId = (operation.courseId ?? "").trim();
    return courseId !== "" && courseIds.has(courseId);
  };
}
