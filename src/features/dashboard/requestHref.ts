import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";

/**
 * 담당 과정(업무요청) → 눌렀을 때 갈 주소.
 *
 * 담당 과정 데이터는 업무요청(OmRequest)에서 오지만, 실제로 보고 싶은 화면은 운영 현황이다.
 * 그래서 운영 현황 상세를 우선한다.
 *
 * 찾는 순서
 *   1. 같은 courseId의 운영 — 지금 상태를 반영하므로 가장 정확하다
 *   2. request.operationId — 접수 때 자동 생성된 운영. 운영이 다시 만들어졌으면 낡을 수 있어 2순위
 *   3. 담당관리 상세 — 운영을 못 찾은 경우의 폴백(주소가 없어 링크가 죽는 것보다 낫다)
 */
export function requestHref(request: OmRequest, operationIdByCourse: Map<string, string>): string {
  // 코스ID가 비어 있으면 매칭을 시도하지 않는다. 운영 쪽에도 코스ID가 빈 건이 있어서
  // ""를 키로 조회하면 서로 무관한 운영에 연결된다.
  const courseId = (request.courseId ?? "").trim();
  const matched = (courseId ? operationIdByCourse.get(courseId) : undefined) || request.operationId;
  return matched ? `/operations/${matched}` : `/om-request/manage/${request.id}`;
}
