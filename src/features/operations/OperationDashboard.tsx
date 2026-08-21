"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { ExternalTableLink, isSafeHttpUrl } from "@/components/ExternalTableLink";
import { SearchableSelect } from "@/components/SearchableSelect";
import type {
  EducationFormat,
  OperationSession
} from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";
import { normalizePersonKey } from "@/lib/data/roleAssignees";
import { satisfactionNumber } from "@/lib/data/satisfaction";
import { getSeoulToday } from "@/lib/seoulDate";
import { teamScopeSearchParam, type TeamScope } from "@/lib/teamScope";

const 전체_파트 = "전체 파트";
const 전체_OM = "전체 OM";

export interface OmRosterEntry {
  name: string;
  team: string | null;
}

interface OperationDashboardProps {
  omRoster: OmRosterEntry[];
  operations: OperationSession[];
  partByPersonKey: Record<string, string>;
  teamScope: TeamScope;
}

/** OM/LD 이름을 멤버관리 등록 파트(TeamUser.team)로 조회해, 이 운영건이 속한 파트 목록을 구한다. */
function operationParts(operation: OperationSession, partByPersonKey: Record<string, string>): Set<string> {
  const names = [...splitPersonNames(operation.om, ""), ...splitPersonNames(operation.ld, "")];
  const parts = new Set<string>();
  for (const name of names) {
    const part = partByPersonKey[normalizePersonKey(name)];
    if (part) parts.add(part);
  }
  return parts;
}

/**
 * 매출 합계를 코스ID당 1번만 집계한다.
 * 같은 코스ID가 여러 과정(행)에 걸쳐 있어도 총액이 중복 집계되지 않는다.
 * 코스ID가 없는 항목은 각각 1건으로 집계한다.
 */
function sumRevenueByCourseId(operations: ReadonlyArray<Pick<OperationSession, "courseId" | "revenue">>): number {
  const countedCourseIds = new Set<string>();
  let total = 0;
  for (const operation of operations) {
    if (operation.courseId) {
      if (countedCourseIds.has(operation.courseId)) continue;
      countedCourseIds.add(operation.courseId);
    }
    total += operation.revenue ?? 0;
  }
  return total;
}

export function OperationDashboard({ omRoster, operations, partByPersonKey, teamScope }: OperationDashboardProps) {
  const today = useMemo(() => getSeoulToday(), []);
  const teamQuery = teamScopeSearchParam(teamScope);
  const [companyFilter, setCompanyFilter] = useState("전체 기업");
  const [formatFilter, setFormatFilter] = useState<"전체 교육형태" | EducationFormat>("전체 교육형태");
  const [omFilter, setOmFilter] = useState(전체_OM);
  const [partFilter, setPartFilter] = useState(전체_파트);
  const [archiveOnly, setArchiveOnly] = useState(false);
  const [query, setQuery] = useState("");
  // 기본 날짜 필터는 "전체"(빈 범위 = 전체 조회). 사용자가 필요할 때 좁힌다.
  const [range, setRange] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const pageSize = 15;
  const teamOperations = operations;

  const filterOptions = useMemo(() => {
    const omsInPart = partFilter === 전체_파트 ? omRoster : omRoster.filter((om) => om.team === partFilter);

    return {
      companies: ["전체 기업", ...unique(teamOperations.map((operation) => operation.companyName))],
      formats: ["전체 교육형태", ...unique(teamOperations.map((operation) => operation.educationFormat))] as Array<
        "전체 교육형태" | EducationFormat
      >,
      oms: [전체_OM, ...unique(omsInPart.map((om) => om.name))],
      parts: [전체_파트, ...unique(omRoster.map((om) => om.team ?? ""))]
    };
  }, [omRoster, partFilter, teamOperations]);

  function handlePartFilterChange(nextPart: string) {
    setPartFilter(nextPart);
    // 파트가 바뀌면 그 파트에 없는 OM이 선택된 채로 남지 않도록 되돌린다.
    setOmFilter(전체_OM);
  }

  const baseFilteredOperations = useMemo(() => {
    return teamOperations.filter((operation) => {
      const normalizedQuery = query.trim().toLowerCase();
      const queryMatches =
        !normalizedQuery ||
        [
          operation.companyName,
          operation.courseName,
          operation.courseId,
          operation.om,
          operation.ld,
          operation.instructors,
          operation.coach
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      const rangeMatches = overlapsRange(operation, range.start, range.end);
      const companyMatches = companyFilter === "전체 기업" || operation.companyName === companyFilter;
      const formatMatches = formatFilter === "전체 교육형태" || operation.educationFormat === formatFilter;
      const omMatches = omFilter === 전체_OM || splitPersonNames(operation.om).includes(omFilter);
      const partMatches = partFilter === 전체_파트 || operationParts(operation, partByPersonKey).has(partFilter);
      const archiveMatches = !archiveOnly || operation.archiveStatus === "아카이빙필요";

      return (
        queryMatches &&
        rangeMatches &&
        companyMatches &&
        formatMatches &&
        omMatches &&
        partMatches &&
        archiveMatches
      );
    });
  }, [archiveOnly, companyFilter, formatFilter, omFilter, partByPersonKey, partFilter, query, range, teamOperations]);

  const filteredOperations = baseFilteredOperations;

  const courseGroups = useMemo(() => {
    return groupOperationsByCourse(filteredOperations, today);
  }, [filteredOperations, today]);

  // 필터로 결과가 줄면 현재 페이지를 유효 범위로 클램프해 빈 페이지가 뜨지 않게 한다.
  const totalPages = Math.max(1, Math.ceil(courseGroups.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedGroups = courseGroups.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageNumbers = getPageNumbers(currentPage, totalPages);

  function goToPage(target: number) {
    setPage(Math.min(Math.max(1, target), totalPages));
  }

  function goToInputPage() {
    const parsed = Number(pageInput);
    if (Number.isFinite(parsed) && parsed >= 1) {
      goToPage(Math.floor(parsed));
    }
    setPageInput("");
  }

  function renderPagination() {
    if (totalPages <= 1) return null;
    return (
      <nav className="operations-pagination" aria-label="페이지 이동">
        <button type="button" className="page-nav" disabled={currentPage <= 1} onClick={() => goToPage(1)}>
          처음
        </button>
        <button
          type="button"
          className="page-nav"
          disabled={currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)}
        >
          이전
        </button>
        {pageNumbers.map((pageNumber, index) =>
          pageNumber === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="page-ellipsis">
              …
            </span>
          ) : (
            <button
              key={pageNumber}
              type="button"
              className={pageNumber === currentPage ? "page-number is-active" : "page-number"}
              aria-current={pageNumber === currentPage ? "page" : undefined}
              onClick={() => goToPage(pageNumber)}
            >
              {pageNumber}
            </button>
          )
        )}
        <button
          type="button"
          className="page-nav"
          disabled={currentPage >= totalPages}
          onClick={() => goToPage(currentPage + 1)}
        >
          다음
        </button>
        <button
          type="button"
          className="page-nav"
          disabled={currentPage >= totalPages}
          onClick={() => goToPage(totalPages)}
        >
          끝
        </button>
        <span className="page-jump">
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageInput}
            placeholder={String(currentPage)}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") goToInputPage();
            }}
            aria-label="이동할 페이지 번호"
          />
          <button type="button" onClick={goToInputPage}>
            이동
          </button>
          <span>/ {totalPages}</span>
        </span>
      </nav>
    );
  }

  const metricCounts = useMemo(() => {
    return {
      진행중: filteredOperations.filter((operation) => isOngoing(operation, today)).length,
      예정: filteredOperations.filter((operation) => isUpcoming(operation, today)).length,
      완료: filteredOperations.filter((operation) => isPast(operation, today)).length
    };
  }, [filteredOperations, today]);

  const satisfaction = average(
    filteredOperations
      .map((operation) => satisfactionNumber(operation.avgSatisfaction))
      .filter((value): value is number => value !== null)
  );
  const totalRevenue = sumRevenueByCourseId(filteredOperations);

  function resetFilters() {
    setCompanyFilter("전체 기업");
    setFormatFilter("전체 교육형태");
    setOmFilter(전체_OM);
    setPartFilter(전체_파트);
    setArchiveOnly(false);
    setQuery("");
    setRange({ start: "", end: "" });
  }

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Operations" teamScope={teamScope} />

      <section className="content operations-page" id="operations">
        <header className="page-header">
          <div>
            <p className="eyebrow">2026.06.09 기준</p>
            <h1>운영 현황</h1>
            <p className="lede">
              기간, 상태, 기업, 교육형태, 담당 OM 기준으로 전체 운영 건을 조회하고 누락/아카이빙 상태를 확인합니다.
            </p>
          </div>
          <div className="header-panel">
            <span>행 기준</span>
            <strong>운영 차수 1개</strong>
          </div>
          <Link className="primary-action" href={`/operations/new${teamQuery}`}>
            + 새 과정 등록
          </Link>
        </header>

        <section className="range-panel operations-range-panel" aria-label="기간 선택">
          <div className="date-range">
            <span>기간</span>
            <input
              aria-label="시작일"
              onChange={(event) => setRange((current) => ({ ...current, start: event.target.value }))}
              type="date"
              value={range.start}
            />
            <span>~</span>
            <input
              aria-label="종료일"
              onChange={(event) => setRange((current) => ({ ...current, end: event.target.value }))}
              type="date"
              value={range.end}
            />
          </div>
          <div className="quick-range" role="group" aria-label="빠른 기간 선택">
            <button type="button" onClick={() => setRange({ start: "", end: "" })}>전체</button>
            <button type="button" onClick={() => setRange(getMonthRange(today, 0))}>이번달</button>
            <button type="button" onClick={() => setRange(getMonthRange(today, 1))}>다음달</button>
            <button type="button" onClick={() => setRange(getQuarterRange(today))}>이번 분기</button>
            <button type="button" onClick={() => setRange(getYearRange(today))}>올해</button>
          </div>
        </section>

        <section className="metrics operations-metrics" aria-label="운영 요약">
          <Metric label="진행중" value={metricCounts.진행중} caption="표시 기준" />
          <Metric label="예정" value={metricCounts.예정} caption="표시 기준" />
          <Metric label="완료" value={metricCounts.완료} caption="표시 기준" />
          <Metric label="평균 만족도" value={satisfaction ?? "-"} caption="표시 기준" />
          <Metric label="총 매출" value={formatShortMoney(totalRevenue)} caption="표시 기준" />
        </section>

        <section className="filter-panel operations-filter-panel" aria-label="상세 필터">
          <SearchableSelect
            ariaLabel="전체 기업"
            onChange={setCompanyFilter}
            options={filterOptions.companies}
            placeholder="기업 검색"
            value={companyFilter}
          />
          <select
            value={formatFilter}
            onChange={(event) => setFormatFilter(event.target.value as "전체 교육형태" | EducationFormat)}
          >
            {filterOptions.formats.map((format) => (
              <option key={format}>{format}</option>
            ))}
          </select>
          <select value={partFilter} onChange={(event) => handlePartFilterChange(event.target.value)}>
            {filterOptions.parts.map((part) => (
              <option key={part}>{part}</option>
            ))}
          </select>
          <select value={omFilter} onChange={(event) => setOmFilter(event.target.value)}>
            {filterOptions.oms.map((om) => (
              <option key={om}>{om}</option>
            ))}
          </select>
          <label className="search">
            <span>검색</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="과정명, 기업명, 강사, 코스ID"
              type="search"
              value={query}
            />
          </label>
          <label className="toggle-filter">
            <input checked={archiveOnly} onChange={(event) => setArchiveOnly(event.target.checked)} type="checkbox" />
            아카이빙 미완료
          </label>
          <button className="secondary-action" type="button" onClick={resetFilters}>
            필터 초기화
          </button>
          <button className="secondary-action" onClick={() => downloadOperationsCsv(courseGroups, today)} type="button">
            엑셀 다운로드
          </button>
          <span className="filter-result-count">총 {courseGroups.length}건</span>
        </section>

        <section className="dashboard-panel operations-list-panel">
          <div className="section-title">
            <h2>운영 목록 (과정 기준)</h2>
            <div className="dashboard-table-meta">
              <span>{courseGroups.length}건</span>
              <span>과정 기준</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>교육형태</th>
                  <th>코스ID</th>
                  <th>기업</th>
                  <th>과정명</th>
                  <th>총 회차</th>
                  <th>싱크업</th>
                  <th>OM</th>
                  <th>LD</th>
                  <th>시작일</th>
                  <th>종료일</th>
                  <th>강사</th>
                  <th>실습코치</th>
                  <th>만족도(평균)</th>
                  <th>매출(코스ID기준)</th>
                </tr>
              </thead>
              <tbody>
                {courseGroups.length > 0 ? (
                  pagedGroups.map((group, index) => (
                    <tr key={group.key}>
                      <td>{(currentPage - 1) * pageSize + index + 1}</td>
                      <td>{summarizeText(group.operations, (operation) => operation.educationFormat)}</td>
                      <td>{group.courseId || "검토필요"}</td>
                      <td><strong>{group.companyName}</strong></td>
                      <td>
                        <Link className="course-link" href={`/operations/${group.linkOperationId}${teamQuery}`}>
                          <strong>{group.courseName}</strong>
                        </Link>
                      </td>
                      <td>{group.operations.length}</td>
                      <td><ExternalTableLink href={group.operationDetail} /></td>
                      <td>{summarizeText(group.operations, (operation) => operation.om, "배정필요")}</td>
                      <td>{summarizeText(group.operations, (operation) => operation.ld, "미정")}</td>
                      <td>{group.startDate}</td>
                      <td>{group.endDate}</td>
                      <td>{summarizeInstructors(group.operations)}</td>
                      <td>{summarizeText(group.operations, (operation) => operation.coach)}</td>
                      <td>{formatSatisfactionValue(average(satisfactionValues(group.operations, (operation) => operation.avgSatisfaction)))}</td>
                      <td>{formatMoney(sumRevenueByCourseId(group.operations))}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={15}>
                      <strong>표시할 운영 건이 없습니다.</strong>
                      <span>필터를 초기화하거나 연결된 운영 데이터 상태를 확인하세요.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderPagination()}
        </section>
      </section>
    </main>
  );
}

function formatSatisfactionValue(value: string | null) {
  return value ?? "-";
}

/**
 * 페이지 번호 목록을 만든다. 페이지가 많으면 현재 페이지 주변만 보이고 나머지는 "…"로 접는다.
 * 예) 현재 5 / 전체 10 → [1, "…", 3, 4, 5, 6, 7, "…", 10]
 */
function getPageNumbers(current: number, total: number): Array<number | "ellipsis"> {
  // 한 번에 숫자 3개만 보여준다(현재 페이지 중심으로 슬라이드). 처음/끝 버튼으로 양끝 이동.
  const windowSize = 3;
  let start = current - 1;
  let end = current + 1;

  if (start < 1) {
    start = 1;
    end = Math.min(total, windowSize);
  }
  if (end > total) {
    end = total;
    start = Math.max(1, total - windowSize + 1);
  }

  const pages: Array<number | "ellipsis"> = [];
  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) pages.push(pageNumber);
  return pages;
}

const OPERATIONS_CSV_HEADERS = [
  "#",
  "교육형태",
  "코스ID",
  "기업",
  "과정명",
  "과정 카테고리 소분류",
  "사용 Tool",
  "총 회차",
  "교육일수",
  "싱크업",
  "OM",
  "LD",
  "시작일",
  "종료일",
  "강사",
  "실습코치",
  "현장 투입 여부",
  "만족도 여부",
  "만족도(전체)",
  "만족도(강사)",
  "결과보고서 여부",
  "매출(코스ID기준)"
];

function downloadOperationsCsv(courseGroups: CourseGroup[], today: Date) {
  const rows = courseGroups.map((group, index) => [
    `${index + 1}`,
    summarizeText(group.operations, (operation) => operation.educationFormat),
    group.courseId || "검토필요",
    group.companyName,
    group.courseName,
    summarizeText(group.operations, (operation) => operation.courseCategory),
    summarizeText(group.operations, (operation) => operation.tools),
    `${group.operations.length}`,
    summarizeText(group.operations, (operation) => operation.educationDays),
    isSafeHttpUrl(group.operationDetail) ? group.operationDetail : "-",
    summarizeText(group.operations, (operation) => operation.om, "배정필요"),
    summarizeText(group.operations, (operation) => operation.ld, "미정"),
    group.startDate,
    group.endDate,
    summarizeInstructors(group.operations),
    summarizeText(group.operations, (operation) => operation.coach),
    onsiteRequiredLabel(summarizeText(group.operations, (operation) => operation.onsiteRequired)),
    summarizeText(group.operations, (operation) => operation.hasSatisfactionSurvey),
    formatSatisfactionValue(average(satisfactionValues(group.operations, (operation) => operation.avgSatisfaction))),
    formatSatisfactionValue(
      average(satisfactionValues(group.operations, (operation) => operation.instructorSatisfaction))
    ),
    summarizeText(group.operations, (operation) => operation.hasResultReport),
    formatMoney(sumRevenueByCourseId(group.operations))
  ]);

  const csvBody = [OPERATIONS_CSV_HEADERS, ...rows]
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\r\n");
  const blob = new Blob(["﻿" + csvBody], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `운영현황_${formatDate(today)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function onsiteRequiredLabel(value: string): string {
  if (value === "Y") return "예";
  if (value === "N") return "아니오";
  if (value === "PARTIAL") return "일부";
  if (value === "UNKNOWN") return "확인필요";
  return value;
}

function escapeCsvField(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function Metric({ caption, label, value }: { caption?: string; label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {caption ? <small>{caption}</small> : null}
    </div>
  );
}

interface CourseGroup {
  companyName: string;
  courseId: string;
  courseName: string;
  endDate: string;
  key: string;
  linkOperationId: string;
  operationDetail: string;
  operations: OperationSession[];
  startDate: string;
}

function groupOperationsByCourse(operations: OperationSession[], today: Date): CourseGroup[] {
  const groups = new Map<string, OperationSession[]>();

  for (const operation of operations) {
    const key = courseGroupKey(operation);
    const existing = groups.get(key) ?? [];
    existing.push(operation);
    groups.set(key, existing);
  }

  return [...groups.entries()]
    .map(([key, groupOperations]) => buildCourseGroup(key, groupOperations, today))
    // 최신 과정이 위에 오도록 시작일 내림차순 정렬(오래된 빈 과정이 1페이지를 가리지 않게).
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

function courseGroupKey(operation: OperationSession): string {
  return `${operation.companyName}__${operation.courseId}__${operation.courseName}`;
}

function buildCourseGroup(key: string, operations: OperationSession[], today: Date): CourseGroup {
  const first = operations[0];
  const startDates = operations.map((operation) => operation.startDate).filter(Boolean).sort();
  const endDates = operations.map((operation) => operation.endDate).filter(Boolean).sort();
  const representative = pickRepresentativeOperation(operations, today);

  return {
    companyName: first.companyName,
    courseId: first.courseId,
    courseName: first.courseName,
    endDate: endDates[endDates.length - 1] ?? "",
    key,
    linkOperationId: representative.operationId,
    operationDetail: operations.find((operation) => operation.operationDetail)?.operationDetail ?? "",
    operations,
    startDate: startDates[0] ?? ""
  };
}

function pickRepresentativeOperation(operations: OperationSession[], today: Date): OperationSession {
  const todayTime = stripTime(today).getTime();
  const withDates = operations.filter((operation) => parseDate(operation.startDate) && parseDate(operation.endDate));

  const current = withDates.find((operation) => {
    const start = parseDate(operation.startDate)!.getTime();
    const end = parseDate(operation.endDate)!.getTime();
    return start <= todayTime && todayTime <= end;
  });
  if (current) return current;

  const upcoming = withDates
    .filter((operation) => parseDate(operation.startDate)!.getTime() > todayTime)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (upcoming.length > 0) return upcoming[0];

  const past = withDates.slice().sort((a, b) => b.endDate.localeCompare(a.endDate));
  if (past.length > 0) return past[0];

  return operations[0];
}

function summarizeText(
  operations: OperationSession[],
  getValue: (operation: OperationSession) => string,
  emptyFallback = "-"
): string {
  const values = unique(operations.map(getValue));
  if (values.length === 0) return emptyFallback;
  if (values.length === 1) return values[0];
  return "상이";
}

function summarizeInstructors(operations: OperationSession[]): string {
  const names = unique(operations.flatMap((operation) => splitPersonNames(operation.instructors, "")));

  if (names.length === 0) return "-";
  if (names.length === 1) return names[0];

  const firstRoundOperation = pickEarliestOperation(operations);
  const firstRoundNames = splitPersonNames(firstRoundOperation.instructors, "").filter(Boolean);
  const primaryName = firstRoundNames[0] ?? names[0];

  return `${primaryName} 외 ${names.length - 1}명`;
}

function pickEarliestOperation(operations: OperationSession[]): OperationSession {
  const withDates = operations.filter((operation) => parseDate(operation.startDate));
  if (withDates.length === 0) return operations[0];
  return withDates.slice().sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
}

function satisfactionValues(
  operations: OperationSession[],
  getValue: (operation: OperationSession) => string
): number[] {
  return operations
    .map((operation) => satisfactionNumber(getValue(operation)))
    .filter((value): value is number => value !== null);
}

function isUpcoming(operation: OperationSession, today: Date) {
  const start = parseDate(operation.startDate);
  return start ? start.getTime() > stripTime(today).getTime() : false;
}

function isOngoing(operation: OperationSession, today: Date) {
  const start = parseDate(operation.startDate);
  const end = parseDate(operation.endDate);
  if (!start || !end) return false;
  const todayTime = stripTime(today).getTime();
  return start.getTime() <= todayTime && todayTime <= end.getTime();
}

function isPast(operation: OperationSession, today: Date) {
  const end = parseDate(operation.endDate);
  return end ? end.getTime() < stripTime(today).getTime() : false;
}

function overlapsRange(operation: OperationSession, startValue: string, endValue: string) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  const operationStart = parseDate(operation.startDate);
  const operationEnd = parseDate(operation.endDate);

  if (!start || !end || !operationStart || !operationEnd) return true;

  return operationStart.getTime() <= end.getTime() && start.getTime() <= operationEnd.getTime();
}

function getMonthRange(date: Date, offset: number) {
  const start = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const end = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0);

  return { start: formatDate(start), end: formatDate(end) };
}

function getQuarterRange(date: Date) {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  const start = new Date(date.getFullYear(), quarterStartMonth, 1);
  const end = new Date(date.getFullYear(), quarterStartMonth + 3, 0);

  return { start: formatDate(start), end: formatDate(end) };
}

function getYearRange(date: Date) {
  return {
    start: `${date.getFullYear()}-01-01`,
    end: `${date.getFullYear()}-12-31`
  };
}

function parseDate(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function stripTime(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function formatDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMoney(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatShortMoney(value: number): string {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (value >= 10000) return `${Math.round(value / 10000).toLocaleString("ko-KR")}만`;
  return value.toLocaleString("ko-KR");
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort(compareStableText);
}

function compareStableText(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
