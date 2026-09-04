import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";
import type { OperationSession } from "@/lib/data/operationTypes";

/** 나의 담당 과정 표의 한 줄. 업무요청과 운영현황 두 원천을 같은 모양으로 맞춘다. */
export interface MyCourseRow {
  key: string;
  company: string;
  courseName: string;
  totalSessions: number;
  ld: string;
  start: string;
  end: string;
  instructor: string;
  href: string;
  /** 어디서 온 줄인지. 표에 배지로 보여 준다. */
  source: "request" | "operation";
  /**
   * 연중 계속 도는 과정(운영유형 연간·상시형)인가.
   *
   * 이런 과정은 시작일이 3월이어도 9월에도 챙길 일이 있다. 달 필터가 시작일 기준으로
   * 숨겨 버리면 담당자가 그 달에 그 과정을 잊는다. 그래서 모든 달에 고정으로 남긴다.
   * 업무요청에는 운영유형이 없어(교육형태만 있다) 요청 줄은 항상 false다.
   */
  alwaysOn: boolean;
}

/**
 * 연중 도는 운영유형. 달 필터가 이 과정을 숨기지 않게 한다.
 * 운영유형은 자유 입력이 아니라 정해진 값이라 문자열 비교로 충분하다.
 */
const ALWAYS_ON_TYPES = new Set(["연간", "상시형"]);

/**
 * 같은 과정으로 묶는 키. 코스ID가 비어 있어도 기업+과정명으로 묶인다.
 *
 * 타입은 string이지만 원천에서 비어 들어온 행이 있을 수 있어 전부 널 가드를 둔다.
 * 이 함수는 /me의 모든 운영마다 돌기 때문에, 한 행만 비어도 대시보드 전체가 죽는다.
 */
function courseKey(operation: OperationSession): string {
  return [
    (operation.courseId ?? "").trim(),
    (operation.companyName ?? "").trim(),
    (operation.courseName ?? "").trim()
  ].join("|");
}

/**
 * 나의 담당 과정 표에 들어갈 줄을 만든다.
 *
 * 전에는 업무요청(담당관리)만 표에 넣었다. 그래서 운영현황에서 OM으로 배정만 된 과정은
 * 캘린더와 D-day에는 뜨는데 표에는 없어서, 담당자가 "내 과정이 아닌가?" 하게 됐다.
 * 이제 운영도 넣는다. 요청과 짝이 되는 운영은 요청 줄이 대표하므로 제외한다
 * (짝짓기 규칙은 requestDedup.ts).
 *
 * 요청 쪽이 차수·세팅 정보가 더 풍부해서 요청을 우선한다.
 */
export function buildMyCourseRows(
  requests: ReadonlyArray<OmRequest>,
  operations: ReadonlyArray<OperationSession>,
  isRepresentedByRequest: (operation: { courseId?: null | string; operationId: string; startDate?: null | string }) => boolean,
  scheduleRange: (request: OmRequest) => { start: string; end: string },
  hrefForRequest: (request: OmRequest) => string
): MyCourseRow[] {
  // 운영의 "총 회차" = 내 담당 운영 중 같은 과정에 속한 회차 수. 운영현황 표와 같은 의미다.
  const roundsByCourse = new Map<string, number>();
  for (const operation of operations) {
    const key = courseKey(operation);
    roundsByCourse.set(key, (roundsByCourse.get(key) ?? 0) + 1);
  }

  const requestRows: MyCourseRow[] = requests.map((request) => {
    const schedule = scheduleRange(request);
    return {
      key: `r-${request.id}`,
      company: request.company,
      courseName: request.courseName,
      totalSessions: request.totalSessions,
      ld: request.ld || "미정",
      start: schedule.start,
      end: schedule.end,
      instructor: request.instructorName || "-",
      href: hrefForRequest(request),
      source: "request",
      alwaysOn: false
    };
  });

  const operationRows: MyCourseRow[] = operations
    .filter((operation) => !isRepresentedByRequest(operation))
    .map((operation) => ({
      key: `o-${operation.operationId}`,
      company: (operation.companyName ?? "").trim(),
      courseName: (operation.courseName ?? "").trim(),
      totalSessions: roundsByCourse.get(courseKey(operation)) ?? 1,
      ld: operation.ld || "미정",
      start: operation.startDate || "-",
      end: operation.endDate || operation.startDate || "-",
      instructor: operation.instructors || "-",
      href: `/operations/${operation.operationId}`,
      source: "operation",
      alwaysOn: ALWAYS_ON_TYPES.has(operation.operationType)
    }));

  // 시작일 순. 날짜가 없는 줄("-")은 뒤로 보낸다 — 앞에 오면 임박한 과정이 밀린다.
  return [...requestRows, ...operationRows].sort((a, b) => {
    const aUnset = a.start === "-" || a.start === "";
    const bUnset = b.start === "-" || b.start === "";
    if (aUnset !== bUnset) return aUnset ? 1 : -1;
    return a.start.localeCompare(b.start);
  });
}
