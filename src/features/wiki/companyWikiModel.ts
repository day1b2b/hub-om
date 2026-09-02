import { splitPersonNames } from "@/lib/data/personNames";
import type { OperationSession } from "@/lib/data/operationTypes";

/** 기업위키의 코스 한 줄. 운영 현황의 같은 과정(코스ID+과정명) 회차를 묶은 것. */
export interface CompanyWikiCourse {
  key: string;
  courseId: string;
  courseName: string;
  rounds: number;
  /** 링크 유무만 본다. 실제 주소는 운영 상세에서 본다. */
  syncup: boolean;
  lms: boolean;
  drive: boolean;
  report: boolean;
  instructors: string;
  startDate: string;
  endDate: string;
  /** 이 과정의 대표 운영. 눌렀을 때 운영 상세로 보낸다. */
  operationId: string;
}

/** 운영 이력 한 줄. 회차 단위다(만족도가 회차별로 붙는다). */
export interface CompanyWikiHistory {
  key: string;
  courseName: string;
  roundNo: string;
  period: string;
  satisfaction: string;
  status: string;
  operationId: string;
}

export interface CompanyWikiEntry {
  name: string;
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
  courses: CompanyWikiCourse[];
  history: CompanyWikiHistory[];
}

function hasLink(value: null | string | undefined): boolean {
  return (value ?? "").trim() !== "";
}

/** 코스ID가 비어도 과정명으로 갈라지도록 둘을 합쳐 키로 쓴다. */
function courseKey(operation: OperationSession): string {
  return `${(operation.courseId ?? "").trim()}|${operation.courseName.trim()}`;
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

function summarizeInstructors(operations: ReadonlyArray<OperationSession>): string {
  const names = uniqueNames(operations, (operation) => operation.instructors);
  if (names.length === 0) return "-";
  // 너무 길어지면 표가 밀리므로 두 명까지만 쓰고 나머지는 수로 접는다.
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}명`;
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
      courseName: list[0].courseName,
      rounds: list.length,
      // 회차 중 하나라도 링크가 있으면 있는 것으로 본다. 회차마다 채워지는 시점이 달라서다.
      syncup: list.some((operation) => hasLink(operation.operationDetail)),
      lms: list.some((operation) => hasLink(operation.lectureManagementLink)),
      drive: list.some((operation) => hasLink(operation.driveLink)),
      report: list.some((operation) => hasLink(operation.resultReportLink)),
      instructors: summarizeInstructors(list),
      startDate: range.first,
      endDate: range.last,
      operationId: list[0].operationId
    });
  }

  // 최근 운영이 위로. 같은 날짜면 과정명 가나다순.
  return courses.sort((a, b) => {
    if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate);
    return a.courseName.localeCompare(b.courseName, "ko");
  });
}

function buildHistory(operations: ReadonlyArray<OperationSession>): CompanyWikiHistory[] {
  return [...operations]
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))
    .map((operation) => {
      const start = (operation.startDate ?? "").trim();
      const end = (operation.endDate ?? "").trim();
      const period = start === "" ? "-" : end === "" || end === start ? start : `${start} ~ ${end}`;
      return {
        key: operation.operationId,
        courseName: operation.courseName,
        roundNo: (operation.roundNo ?? "").trim() || "-",
        period,
        satisfaction: (operation.avgSatisfaction ?? "").trim() || "-",
        status: operation.operationStatus,
        operationId: operation.operationId
      };
    });
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
 * 이제 목록·코스·이력·담당자는 모두 운영 현황에서 온다.
 *
 * 운영 현황에 없는 항목(고객사 담당자 연락처, 교육장·보안, 정산 프로세스, 운영 제언)은
 * 지어내지 않고 비워 둔다. 화면에서 "기록 없음"으로 보여 준다.
 */
export function aggregateCompanies(operations: ReadonlyArray<OperationSession>): CompanyWikiEntry[] {
  // 공백만 다른 표기는 같은 기업으로 묶는다("삼성전자 DS" 1회차 ↔ "삼성전자DS" 75회차).
  // 공백 외의 차이는 합치지 않는다 — "KB"와 "KB국민은행"처럼 같은 곳인지 알 수 없는 쌍이 있다.
  const byCompany = new Map<string, OperationSession[]>();
  for (const operation of operations) {
    const name = (operation.companyName ?? "").trim();
    if (!name) continue; // 기업명이 없는 행은 위키에 세울 수 없다.
    const key = name.replace(/\s+/g, "").toLowerCase();
    const list = byCompany.get(key);
    if (list) list.push(operation);
    else byCompany.set(key, [operation]);
  }

  const entries: CompanyWikiEntry[] = [];
  for (const list of byCompany.values()) {
    const name = displayCompanyName(list);
    const range = dateRange(list);
    const courses = buildCourses(list);
    entries.push({
      name,
      omNames: uniqueNames(list, (operation) => operation.om),
      ldNames: uniqueNames(list, (operation) => operation.ld),
      courseCount: courses.length,
      roundCount: list.length,
      firstDate: range.first,
      lastDate: range.last,
      years: [...new Set(list.map((operation) => (operation.startDate ?? "").slice(0, 4)).filter(Boolean))].sort(),
      avgSatisfaction: averageSatisfaction(list),
      courses,
      history: buildHistory(list)
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
