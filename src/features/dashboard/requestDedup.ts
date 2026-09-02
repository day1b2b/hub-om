import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";

/**
 * 담당 과정(요청)과 운영 현황은 같은 과정을 양쪽에서 들고 있다.
 * 내 대시보드의 캘린더·사전세팅에서 같은 과정이 두 번 뜨지 않도록,
 * "이 운영은 담당 과정이 이미 대표하고 있는가"를 판단한다.
 *
 * 짝을 맞추는 순서
 *   1. operationId — 요청 접수 때 자동 생성한 운영을 가리킨다. 코스ID가 없어도 정확하다.
 *   2. courseId + 시작일 — 나중에 코스ID가 채워져 운영이 따로 만들어진 경우를 잡는다.
 *
 * 코스ID만으로 짝을 지으면 안 된다. 코스ID는 과정 단위라 회차를 구분하지 못한다.
 * 실제로 HL만도 AX 교육 실무3(11/02)과 실무4(11/16)가 코스ID 261578을 공유하는데,
 * 실무4에만 담당 과정이 있으면 실무3까지 "이미 표시됨"으로 걸러져 화면에서 사라졌다.
 * 그래서 코스ID가 같아도 요청의 세션 날짜에 없는 회차는 남긴다.
 *
 * 빈 코스ID도 짝짓기에 쓰지 않는다. ""를 키로 쓰면 코스ID가 비어 있는 운영이 전부
 * "이미 표시됨"으로 걸러져 캘린더와 사전세팅에서 통째로 사라진다.
 *
 * 어긋날 때는 숨기기보다 두 번 보이는 쪽을 택한다. 중복은 눈에 거슬릴 뿐이지만
 * 누락은 담당자가 과정을 통째로 놓치게 만든다.
 */
export function createRequestMatcher(requests: ReadonlyArray<OmRequest>) {
  const operationIds = new Set(
    requests.map((request) => (request.operationId ?? "").trim()).filter(Boolean)
  );

  // "코스ID|시작일" 조합. 같은 코스ID의 다른 회차를 서로 다른 키로 갈라 놓는다.
  const courseDates = new Set<string>();
  for (const request of requests) {
    const courseId = (request.courseId ?? "").trim();
    if (!courseId) continue;
    for (const session of request.sessions ?? []) {
      const date = (session.date ?? "").trim();
      if (date) courseDates.add(`${courseId}|${date}`);
    }
  }

  return function isRepresentedByRequest(operation: {
    courseId?: null | string;
    operationId: string;
    startDate?: null | string;
  }): boolean {
    if (operationIds.has(operation.operationId.trim())) return true;

    const courseId = (operation.courseId ?? "").trim();
    const startDate = (operation.startDate ?? "").trim();
    if (!courseId || !startDate) return false;
    return courseDates.has(`${courseId}|${startDate}`);
  };
}
