"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  EducationFormat,
  OperationSession,
  OperationStatus,
  SourceTeam
} from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";

const STATUS_FILTERS = ["전체", "진행중", "예정", "완료", "아카이빙필요", "검토필요"] as const;
const TEAM_FILTERS = ["전체", "1팀", "2팀", "미분류"] as const;
const STATUS_CLASS: Record<OperationStatus, string> = {
  "배정필요": "needs-assignment",
  "배정예정": "planned-assignment",
  "진행중": "active",
  "완료": "done",
  "회고완료": "retrospective-done",
  "아카이빙필요": "archive-needed"
};

interface OperationDashboardProps {
  operations: OperationSession[];
}

export function OperationDashboard({ operations }: OperationDashboardProps) {
  const today = useMemo(() => new Date(), []);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("전체");
  const [companyFilter, setCompanyFilter] = useState("전체 기업");
  const [formatFilter, setFormatFilter] = useState<"전체 교육형태" | EducationFormat>("전체 교육형태");
  const [omFilter, setOmFilter] = useState("전체 OM");
  const [teamFilter, setTeamFilter] = useState<(typeof TEAM_FILTERS)[number]>("전체");
  const [archiveOnly, setArchiveOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState(() => getMonthRange(today, 0));
  const teamOperations = useMemo(
    () => operations.filter((operation) => teamFilter === "전체" || getSourceTeam(operation) === teamFilter),
    [operations, teamFilter]
  );

  const filterOptions = useMemo(() => {
    return {
      companies: ["전체 기업", ...unique(teamOperations.map((operation) => operation.companyName))],
      formats: ["전체 교육형태", ...unique(teamOperations.map((operation) => operation.educationFormat))] as Array<
        "전체 교육형태" | EducationFormat
      >,
      oms: ["전체 OM", ...unique(teamOperations.flatMap((operation) => splitPersonNames(operation.om)))]
    };
  }, [teamOperations]);

  const statusCounts = useMemo(() => {
    return {
      전체: teamOperations.length,
      진행중: teamOperations.filter((operation) => operation.operationStatus === "진행중").length,
      예정: teamOperations.filter((operation) => isUpcoming(operation, today)).length,
      완료: teamOperations.filter((operation) => isDone(operation)).length,
      아카이빙필요: teamOperations.filter((operation) => operation.archiveStatus === "아카이빙필요").length,
      검토필요: teamOperations.filter((operation) => operation.validationStatus === "검토필요").length
    };
  }, [teamOperations, today]);

  const filteredOperations = useMemo(() => {
    return teamOperations.filter((operation) => {
      const normalizedQuery = query.trim().toLowerCase();
      const statusMatches =
        statusFilter === "전체" ||
        operation.operationStatus === statusFilter ||
        operation.archiveStatus === statusFilter ||
        (statusFilter === "예정" && isUpcoming(operation, today)) ||
        (statusFilter === "완료" && isDone(operation)) ||
        (statusFilter === "검토필요" && operation.validationStatus === "검토필요");
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
      const omMatches = omFilter === "전체 OM" || splitPersonNames(operation.om).includes(omFilter);
      const archiveMatches = !archiveOnly || operation.archiveStatus === "아카이빙필요";

      return (
        statusMatches &&
        queryMatches &&
        rangeMatches &&
        companyMatches &&
        formatMatches &&
        omMatches &&
        archiveMatches
      );
    });
  }, [archiveOnly, companyFilter, formatFilter, omFilter, query, range, statusFilter, teamOperations, today]);

  const satisfaction = average(
    teamOperations
      .map((operation) => operation.avgSatisfaction)
      .filter(Boolean)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
  );
  const totalRevenue = teamOperations.reduce((sum, operation) => sum + (operation.revenue ?? 0), 0);

  return (
    <main className="dashboard-shell">
      <aside className="sidebar" aria-label="hub-om 메뉴">
        <div className="brand">
          <span className="brand-mark">OD</span>
          <div>
            <strong>hub-om</strong>
            <span>Operations</span>
          </div>
        </div>
        <nav className="nav-list">
          <Link href="/">대시보드</Link>
          <Link className="active" href="/operations">운영 현황</Link>
          <Link href="/resources">리소스</Link>
        </nav>
      </aside>

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
            <button type="button" onClick={() => setRange(getMonthRange(today, 0))}>이번달</button>
            <button type="button" onClick={() => setRange(getMonthRange(today, 1))}>다음달</button>
            <button type="button" onClick={() => setRange(getQuarterRange(today))}>이번 분기</button>
            <button type="button" onClick={() => setRange(getYearRange(today))}>올해</button>
          </div>
          <div className="team-tabs operations-team-tabs" role="group" aria-label="팀 선택">
            {TEAM_FILTERS.map((team) => (
              <button
                aria-pressed={teamFilter === team}
                className={teamFilter === team ? "selected" : ""}
                key={team}
                onClick={() => setTeamFilter(team)}
                type="button"
              >
                {team}
              </button>
            ))}
          </div>
        </section>

        <section className="status-tabs" aria-label="상태 필터">
          {STATUS_FILTERS.map((item) => (
            <button
              aria-pressed={statusFilter === item}
              className={statusFilter === item ? "selected" : ""}
              key={item}
              onClick={() => setStatusFilter(item)}
              type="button"
            >
              {item}
              <span>{statusCounts[item]}</span>
            </button>
          ))}
        </section>

        <section className="metrics operations-metrics" aria-label="운영 요약">
          <Metric label="진행중" value={statusCounts.진행중} caption="현재 운영" />
          <Metric label="예정" value={statusCounts.예정} caption="선택 기간" />
          <Metric label="완료" value={statusCounts.완료} caption="회고 포함" />
          <Metric label="전체 과정" value={teamOperations.length} caption={`${filteredOperations.length}개 표시`} />
          <Metric label="평균 만족도" value={satisfaction ?? "-"} caption="입력된 값 기준" />
          <Metric label="총 매출" value={formatShortMoney(totalRevenue)} caption="데모 기준" />
        </section>

        <section className="filter-panel operations-filter-panel" aria-label="상세 필터">
          <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
            {filterOptions.companies.map((company) => (
              <option key={company}>{company}</option>
            ))}
          </select>
          <select
            value={formatFilter}
            onChange={(event) => setFormatFilter(event.target.value as "전체 교육형태" | EducationFormat)}
          >
            {filterOptions.formats.map((format) => (
              <option key={format}>{format}</option>
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
          <button className="secondary-action" type="button">엑셀 다운로드</button>
          <span className="filter-result-count">총 {filteredOperations.length}건</span>
        </section>

        <section className="dashboard-panel operations-list-panel">
          <div className="section-title">
            <h2>운영 목록</h2>
            <div className="dashboard-table-meta">
              <span>{filteredOperations.length}건</span>
              <span>운영 차수 기준</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>상태</th>
                  <th>교육형태</th>
                  <th>운영유형</th>
                  <th>코스ID</th>
                  <th>기업</th>
                  <th>과정명</th>
                  <th>싱크업</th>
                  <th>OM</th>
                  <th>LD</th>
                  <th>시작일</th>
                  <th>종료일</th>
                  <th>강사</th>
                  <th>실습코치</th>
                  <th>만족도(전체)</th>
                  <th>만족도(강사)</th>
                  <th>매출</th>
                  <th>강사비</th>
                  <th>운영비</th>
                </tr>
              </thead>
              <tbody>
                {filteredOperations.length > 0 ? (
                  filteredOperations.map((operation, index) => (
                    <tr key={operation.operationId}>
                      <td>{index + 1}</td>
                      <td><StatusBadge status={operation.operationStatus} /></td>
                      <td>{operation.educationFormat}</td>
                      <td>{operation.operationType}</td>
                      <td>{operation.courseId || "검토필요"}</td>
                      <td><strong>{operation.companyName}</strong></td>
                      <td>
                        <Link className="course-link" href={`/operations/${operation.operationId}`}>
                          <strong>{operation.courseName}</strong>
                        </Link>
                      </td>
                      <td><ExternalTableLink href={operation.operationDetail} /></td>
                      <td>{operation.om || "배정필요"}</td>
                      <td>{operation.ld || "미정"}</td>
                      <td>{operation.startDate}</td>
                      <td>{operation.endDate}</td>
                      <td>{operation.instructors || "-"}</td>
                      <td>{operation.coach || "-"}</td>
                      <td>{operation.avgSatisfaction || "-"}</td>
                      <td>{operation.instructorSatisfaction || "-"}</td>
                      <td>{formatMoney(operation.revenue)}</td>
                      <td>{formatMoney(operation.instructorCost)}</td>
                      <td>{formatMoney(operation.operationCost)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={19}>
                      <strong>표시할 운영 건이 없습니다.</strong>
                      <span>필터를 초기화하거나 연결된 운영 데이터 상태를 확인하세요.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
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

function StatusBadge({ status }: { status: OperationStatus }) {
  return <span className={`status ${STATUS_CLASS[status]}`}>{status}</span>;
}

function ExternalTableLink({ href }: { href: string }) {
  if (!isSafeHttpUrl(href)) return <span className="muted-inline">-</span>;

  return (
    <a aria-label="싱크업 열기" className="table-link-icon" href={href} rel="noreferrer" target="_blank">
      ↗
    </a>
  );
}

function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getSourceTeam(operation: OperationSession): SourceTeam {
  return operation.sourceTeam ?? "미분류";
}

function isUpcoming(operation: OperationSession, today: Date) {
  const start = parseDate(operation.startDate);
  return start ? start.getTime() > stripTime(today).getTime() : false;
}

function isDone(operation: OperationSession) {
  return operation.operationStatus === "완료" || operation.operationStatus === "회고완료";
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
