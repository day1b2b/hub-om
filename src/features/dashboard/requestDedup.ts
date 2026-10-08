import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";

/** 짝짓기에 쓰는 운영 쪽 최소 모양. OperationSession이 그대로 들어맞는다. */
export interface RepresentableOperation {
  companyName?: null | string;
  courseId?: null | string;
  courseName?: null | string;
  operationId: string;
  startDate?: null | string;
}

/** 기업명·과정명 표기 흔들림(앞뒤 공백, 사이 공백, 대소문자)을 흡수한다. */
function normalizeName(value: null | string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function nameKey(company: null | string | undefined, course: null | string | undefined, date: string): string {
  return `${normalizeName(company)}|${normalizeName(course)}|${date}`;
}

/**
 * 담당 과정(요청)과 운영 현황은 같은 과정을 양쪽에서 들고 있다.
 * 내 대시보드의 캘린더·사전세팅에서 같은 과정이 두 번 뜨지 않도록,
 * "이 운영은 담당 과정이 이미 대표하고 있는가"를 판단한다.
 *
 * 짝을 맞추는 순서
 *   1. operationId — 요청 접수 때 자동 생성한 운영을 가리킨다. 코스ID가 없어도 정확하다.
 *   2. courseId + 시작일 — 나중에 코스ID가 채워져 운영이 따로 만들어진 경우를 잡는다.
 *   3. 기업명 + 과정명 + 시작일 — 운영에 코스ID가 없을 때만 쓰는 마지막 수단.
 *
 * 3번이 필요한 이유. 요청 접수 때 createLinkedOperationForOmRequest가 차수마다 운영을
 * 하나씩 만드는데, 요청에 적히는 operationId는 **1차수 하나뿐**이다. 접수 시점에는 코스ID도
 * 아직 안 정해져서 비어 있다. 그래서 2차수부터는 1번(operationId 불일치)도 2번(코스ID 없음)도
 * 못 잡고 운영 막대와 요청 막대가 같은 날 나란히 그려졌다 — 같은 과정이 캘린더에 두 번 뜨는
 * 증상(2026-10-07 제보). 코스ID가 있는 운영은 2번이 이미 정확하므로 3번을 쓰지 않는다.
 *
 * 코스ID만으로 짝을 지으면 안 된다. 코스ID는 과정 단위라 회차를 구분하지 못한다.
 * 실제로 HL만도 AX 교육 실무3(11/02)과 실무4(11/16)가 코스ID 261578을 공유하는데,
 * 실무4에만 담당 과정이 있으면 실무3까지 "이미 표시됨"으로 걸러져 화면에서 사라졌다.
 * 그래서 코스ID가 같아도 요청의 세션 날짜에 없는 회차는 남긴다. 3번도 같은 이유로
 * 날짜를 함께 묶는다 — 기업명+과정명만으로는 다른 날 회차까지 지운다.
 *
 * 빈 코스ID도 짝짓기에 쓰지 않는다. ""를 키로 쓰면 코스ID가 비어 있는 운영이 전부
 * "이미 표시됨"으로 걸러져 캘린더와 사전세팅에서 통째로 사라진다.
 *
 * 교육 일정 차수가 아직 안 들어온 요청은 아무것도 대표하지 못한다. 캘린더에 찍을 날짜가
 * 없어서 담당 과정 표에만 남고, 그 요청이 짝인 운영까지 지우면 과정이 화면에서 사라진다.
 * (담당 과정 1건 · 예정 1건인데 D-day는 "예정된 과정이 없습니다"가 되던 증상.)
 * 그래서 날짜가 있는 차수를 하나라도 가진 요청만 대표 자격을 준다.
 *
 * 어긋날 때는 숨기기보다 두 번 보이는 쪽을 택한다. 중복은 눈에 거슬릴 뿐이지만
 * 누락은 담당자가 과정을 통째로 놓치게 만든다.
 */
export function createRequestMatcher(requests: ReadonlyArray<OmRequest>) {
  const hasDatedSession = (request: OmRequest) =>
    (request.sessions ?? []).some((session) => (session.date ?? "").trim() !== "");
  const scheduled = requests.filter(hasDatedSession);

  const operationIds = new Set(
    scheduled.map((request) => (request.operationId ?? "").trim()).filter(Boolean)
  );

  // "코스ID|시작일" 조합. 같은 코스ID의 다른 회차를 서로 다른 키로 갈라 놓는다.
  const courseDates = new Set<string>();
  // "기업명|과정명|시작일" 조합. 코스ID가 없는 운영에만 쓴다.
  const nameDates = new Set<string>();
  for (const request of scheduled) {
    const courseId = (request.courseId ?? "").trim();
    for (const session of request.sessions ?? []) {
      const date = (session.date ?? "").trim();
      if (!date) continue;
      if (courseId) courseDates.add(`${courseId}|${date}`);
      nameDates.add(nameKey(request.company, request.courseName, date));
    }
  }

  return function isRepresentedByRequest(operation: RepresentableOperation): boolean {
    if (operationIds.has(operation.operationId.trim())) return true;

    const startDate = (operation.startDate ?? "").trim();
    if (!startDate) return false;

    const courseId = (operation.courseId ?? "").trim();
    if (courseId) return courseDates.has(`${courseId}|${startDate}`);

    const company = normalizeName(operation.companyName);
    const course = normalizeName(operation.courseName);
    if (!company || !course) return false;
    return nameDates.has(nameKey(company, course, startDate));
  };
}
