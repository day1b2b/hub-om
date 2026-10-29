import { sumRevenueByCourseId } from "@/lib/data/operationCalculations";
import { splitPersonNames } from "@/lib/data/personNames";
import type { OperationSession } from "@/lib/data/operationTypes";

/** 기업위키의 코스 한 줄. 운영 현황의 같은 과정(코스ID+과정명) 회차를 묶은 것. 운영현황(/operations)과 같은 열 구성. */
export interface CompanyWikiCourse {
  key: string;
  courseId: string;
  courseName: string;
  /** 코스ID명(운영현황의 courseIdLabel). 계산서 발행 요청 구글폼의 "과정명"은 이 값을 쓴다 — 미정이면 빈 문자열. */
  courseIdLabel: string;
  rounds: number;
  startDate: string;
  endDate: string;
  instructors: string;
  /** 만족도가 기록된 회차의 평균. 없으면 "-". */
  avgSatisfaction: string;
  /** 코스ID 기준 매출(세일즈맵 연동). 없으면 "-". */
  revenue: string;
  om: string;
  ld: string;
  /** 이 과정의 대표 운영. 눌렀을 때 운영 상세로 보낸다. */
  operationId: string;
}

export interface CompanyWikiEntry {
  name: string;
  /** Company.id. 로컬 JSON/외부 병합 데이터엔 없을 수 있다 — 그럴 땐 사업자등록증 정보 수정이 불가하다. */
  companyId: string | null;
  omNames: string[];
  ldNames: string[];
  courseCount: number;
  roundCount: number;
  /** 가장 이른/늦은 운영 시작일. 빈 값은 "-". */
  firstDate: string;
  lastDate: string;
  years: string[];
  /** 만족도가 기록된 회차의 평균. 없으면 "-". */
  avgSatisfaction: string;
  /** 전체 코스ID 기준 매출 합. 없으면 "-". */
  totalRevenue: string;
  courses: CompanyWikiCourse[];
}

/** 코스ID가 비어도 과정명으로 갈라지도록 둘을 합쳐 키로 쓴다. */
function courseKey(operation: OperationSession): string {
  return `${(operation.courseId ?? "").trim()}|${(operation.courseName ?? "").trim()}`;
}

function uniqueNames(operations: ReadonlyArray<OperationSession>, pick: (o: OperationSession) => string): string[] {
  const names = new Set<string>();
  for (const operation of operations) {
    for (const name of splitPersonNames(pick(operation), "")) {
      const trimmed = name.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "ko"));
}

function dateRange(operations: ReadonlyArray<OperationSession>): { first: string; last: string } {
  const dates = operations
    .map((operation) => (operation.startDate ?? "").trim())
    .filter(Boolean)
    .sort();
  if (dates.length === 0) return { first: "-", last: "-" };
  return { first: dates[0], last: dates[dates.length - 1] };
}

/** 만족도는 문자열 칼럼이라 숫자로 읽히는 것만 센다. 소수 둘째 자리까지. */
function averageSatisfaction(operations: ReadonlyArray<OperationSession>): string {
  const scores = operations
    .map((operation) => Number.parseFloat((operation.avgSatisfaction ?? "").trim()))
    .filter((score) => Number.isFinite(score));
  if (scores.length === 0) return "-";
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return (Math.round(mean * 100) / 100).toString();
}

/** 이 코스를 맡은 OM/LD. 회차마다 바뀌었을 수 있어 중복 없이 모아 보여 준다. */
function summarizeNames(operations: ReadonlyArray<OperationSession>, pick: (o: OperationSession) => string, fallback: string): string {
  const names = uniqueNames(operations, pick);
  return names.length > 0 ? names.join(", ") : fallback;
}

function summarizeInstructors(operations: ReadonlyArray<OperationSession>): string {
  const names = uniqueNames(operations, (operation) => operation.instructors);
  if (names.length === 0) return "-";
  // 너무 길어지면 표가 밀리므로 두 명까지만 쓰고 나머지는 수로 접는다.
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}명`;
}

/** 운영현황(/operations)의 "매출(코스ID기준)"과 같은 포맷. */
function formatRevenue(operations: ReadonlyArray<OperationSession>): string {
  return new Intl.NumberFormat("ko-KR").format(sumRevenueByCourseId(operations));
}

function buildCourses(operations: ReadonlyArray<OperationSession>): CompanyWikiCourse[] {
  const groups = new Map<string, OperationSession[]>();
  for (const operation of operations) {
    const key = courseKey(operation);
    const list = groups.get(key);
    if (list) list.push(operation);
    else groups.set(key, [operation]);
  }

  const courses: CompanyWikiCourse[] = [];
  for (const [key, list] of groups) {
    const range = dateRange(list);
    courses.push({
      key,
      courseId: (list[0].courseId ?? "").trim(),
      courseName: (list[0].courseName ?? "").trim(),
      courseIdLabel: (list[0].courseIdLabel ?? "").trim(),
      rounds: list.length,
      startDate: range.first,
      endDate: range.last,
      instructors: summarizeInstructors(list),
      avgSatisfaction: averageSatisfaction(list),
      revenue: formatRevenue(list),
      om: summarizeNames(list, (operation) => operation.om, "배정필요"),
      ld: summarizeNames(list, (operation) => operation.ld, "미정"),
      operationId: list[0].operationId
    });
  }

  // 최근 운영이 위로. 같은 날짜면 과정명 가나다순.
  return courses.sort((a, b) => {
    if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate);
    return (a.courseName ?? "").localeCompare(b.courseName ?? "", "ko");
  });
}

/**
 * 기업을 묶는 키. companyId(Company.id)가 있으면 그것을 쓴다 — 기업을 식별하는 값이라
 * 운영 현황의 기업명 표기가 흔들려도 같은 기업으로 남는다.
 *
 * companyId가 없을 수도 있다(로컬 JSON 저장소, 외부 원천 병합 항목). 그때는 기업명으로
 * 묶되 공백과 대소문자는 무시한다("삼성전자 DS" ↔ "삼성전자DS"). 공백 외의 차이는
 * 합치지 않는다 — "KB"와 "KB국민은행"처럼 같은 곳인지 알 수 없는 쌍이 있어서,
 * 임의로 묶으면 서로 다른 기업의 이력이 섞인다.
 *
 * 남은 한계: 이미 Company 행이 두 개로 갈려 있으면(예: 등록 당시 표기가 달랐다면)
 * companyId도 둘이라 여기서 합쳐지지 않는다. 그건 운영 현황 표기를 통일해 원본에서
 * 풀어야 한다.
 */
function companyGroupKey(operation: OperationSession, trimmedName: string): string {
  const companyId = (operation.companyId ?? "").trim();
  if (companyId) return `id:${companyId}`;
  return `name:${trimmedName.replace(/\s+/g, "").toLowerCase()}`;
}

/**
 * companyId(Company.id). companyGroupKey가 이미 companyId 우선으로 묶으므로 그룹 안에서는
 * 보통 하나만 있다 — 그래도 섞여 있으면 가장 많이 나온 값을 쓴다. 전부 없으면(로컬 JSON/외부
 * 병합) null — 그 경우 기업위키에서 사업자등록증 정보를 수정할 수 없다.
 */
function companyIdOf(operations: ReadonlyArray<OperationSession>): string | null {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    const companyId = (operation.companyId ?? "").trim();
    if (companyId) counts.set(companyId, (counts.get(companyId) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * 묶인 표기 중 화면에 쓸 이름. 회차가 가장 많은 표기를 대표로 쓴다.
 * 회차 수가 같으면 가나다순으로 앞선 것을 골라 결과가 흔들리지 않게 한다.
 */
function displayCompanyName(operations: ReadonlyArray<OperationSession>): string {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    const name = (operation.companyName ?? "").trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], "ko");
  })[0][0];
}

/**
 * 운영 현황에서 기업위키 목록을 만든다.
 *
 * 전에는 기업 목록이 하드코딩 배열이었고 상세는 기업명 해시로 만든 가짜 값이었다.
 * 담당 OM·연락처·만족도까지 지어냈기 때문에, 읽는 사람이 실제 정보로 착각할 수 있었다.
 * 이제 목록·코스·담당자는 모두 운영 현황에서 온다.
 *
 * 운영 현황에 없는 항목(고객사 담당자 연락처, 교육장·보안, 정산 프로세스, 운영 제언)은
 * 지어내지 않고 비워 둔다. 화면에서 "기록 없음"으로 보여 준다.
 */
export function aggregateCompanies(operations: ReadonlyArray<OperationSession>): CompanyWikiEntry[] {
  const byCompany = new Map<string, OperationSession[]>();
  for (const operation of operations) {
    const name = (operation.companyName ?? "").trim();
    if (!name) continue; // 기업명이 없는 행은 위키에 세울 수 없다.
    const list = byCompany.get(companyGroupKey(operation, name));
    if (list) list.push(operation);
    else byCompany.set(companyGroupKey(operation, name), [operation]);
  }

  const entries: CompanyWikiEntry[] = [];
  for (const list of byCompany.values()) {
    const name = displayCompanyName(list);
    const range = dateRange(list);
    const courses = buildCourses(list);
    entries.push({
      name,
      companyId: companyIdOf(list),
      omNames: uniqueNames(list, (operation) => operation.om),
      ldNames: uniqueNames(list, (operation) => operation.ld),
      courseCount: courses.length,
      roundCount: list.length,
      firstDate: range.first,
      lastDate: range.last,
      years: [...new Set(list.map((operation) => (operation.startDate ?? "").slice(0, 4)).filter(Boolean))].sort(),
      avgSatisfaction: averageSatisfaction(list),
      totalRevenue: formatRevenue(list),
      courses
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
