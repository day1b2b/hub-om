"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { extractIssueTagsFromNote } from "@/lib/data/lectureNote";
import type { OperationSession } from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";
import { TEAM_OPTIONS, type TeamUser } from "@/lib/data/teamUsers/teamUserTypes";
import { teamScopeSearchParam, type TeamScope } from "@/lib/teamScope";

type DashboardScope = "이번달" | "연간";

const OM_PART_ALL = "전체";
type OmPartFilter = typeof OM_PART_ALL | (typeof TEAM_OPTIONS)[number];

interface MainDashboardProps {
  operations: OperationSession[];
  teamScope: TeamScope;
  teamUsers: TeamUser[];
}

export function MainDashboard({ operations, teamScope, teamUsers }: MainDashboardProps) {
  const today = useMemo(() => new Date(), []);
  const [scope, setScope] = useState<DashboardScope>("이번달");
  const [omPart, setOmPart] = useState<OmPartFilter>(OM_PART_ALL);
  const teamQuery = teamScopeSearchParam(teamScope);

  const omPartByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of teamUsers) {
      if (user.role === "om" && user.team) {
        map.set(user.name.trim(), user.team);
      }
    }
    return map;
  }, [teamUsers]);

  const omPartOperations = useMemo(() => {
    if (omPart === OM_PART_ALL) return operations;
    return operations.filter((operation) => resolveOperationOmPart(operation, omPartByName) === omPart);
  }, [operations, omPart, omPartByName]);

  const scopedOperations = useMemo(() => {
    return omPartOperations.filter((operation) =>
      scope === "이번달" ? isSameMonth(operation, today) : isSameYear(operation, today)
    );
  }, [scope, omPartOperations, today]);

  const activeOrUpcoming = scopedOperations
    .filter((operation) => !isEnded(operation, today))
    .sort((a, b) => compareStableText(a.startDate, b.startDate));
  const omCounts = topCounts(scopedOperations.flatMap((operation) => splitPersonNames(operation.om)), 5);
  const formatCounts = topCounts(scopedOperations.map((operation) => operation.educationFormat), 5);
  const monthlyCounts = monthlySeries(omPartOperations, today.getFullYear());

  // 과정(Course.id) 기준 카운트: 회차가 여러 건인 과정을 중복 집계하지 않기 위해 과정당 1건으로 축약한다.
  const scopedCourses = dedupeByCourse(scopedOperations);
  const courseCount = scopedCourses.length;
  // 진행중/예정/완료는 과정의 전체 회차(첫 회차 시작일 ~ 마지막 회차 종료일) 기간 기준으로 판정한다.
  const coursePeriods = buildCoursePeriods(omPartOperations);
  const companyCounts = topCounts(scopedCourses.map((operation) => operation.companyName), 5);
  const categoryCounts = topCounts(scopedCourses.map((operation) => operation.courseCategory), 5);
  const uncategorizedCount = scopedCourses.filter((operation) => !operation.courseCategory).length;
  const toolCounts = topCounts(
    scopedCourses.flatMap((operation) => splitToolsList(operation.tools ?? "")),
    8
  );
  // 이슈는 회차(강의)마다 발생하므로 과정 단위(scopedCourses)가 아닌 회차 단위(scopedOperations)로 집계한다.
  const issueTagCounts = topCounts(
    scopedOperations.flatMap((operation) => extractIssueTagsFromNote(operation.lectureManagementNote)),
    8
  );

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Dashboard" teamScope={teamScope} />

      <section className="content dashboard-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">2026.06.09 기준</p>
            <h1>메인 대시보드</h1>
            <p className="lede">전체 운영 규모, 진행 상태, 주요 병목을 먼저 확인하는 리더용 요약 화면입니다.</p>
          </div>
          <div className="header-panel">
            <span>데이터 기준</span>
            <strong>{scope} 현황</strong>
          </div>
        </header>

        <div className="dashboard-controls" aria-label="대시보드 필터">
          <div className="dashboard-tabs" role="group" aria-label="대시보드 범위">
            {(["이번달", "연간"] as DashboardScope[]).map((item) => (
              <button
                aria-pressed={scope === item}
                className={scope === item ? "selected" : ""}
                key={item}
                onClick={() => setScope(item)}
                type="button"
              >
                {item} 현황
              </button>
            ))}
          </div>

          <div className="dashboard-team-tabs team-tabs" role="group" aria-label="OM 파트 범위">
            {([OM_PART_ALL, ...TEAM_OPTIONS] as OmPartFilter[]).map((option) => (
              <button
                aria-pressed={omPart === option}
                className={omPart === option ? "selected" : ""}
                key={option}
                onClick={() => setOmPart(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <section className="metrics" aria-label="운영 요약">
          <Metric
            label="진행중"
            value={scopedCourses.filter((course) => courseStatus(course, coursePeriods, today) === "진행중").length}
          />
          <Metric
            label="예정"
            value={scopedCourses.filter((course) => courseStatus(course, coursePeriods, today) === "예정").length}
          />
          <Metric
            label="완료"
            value={scopedCourses.filter((course) => courseStatus(course, coursePeriods, today) === "완료").length}
          />
          <Metric label="총 매출" value={formatShortMoney(scopedCourses.reduce((sum, operation) => sum + (operation.revenue ?? 0), 0))} />
          <Metric label="참여 기업" value={new Set(scopedOperations.map((operation) => operation.companyName)).size} />
          <Metric label="전체 과정" value={courseCount} />
        </section>

        <section className="dashboard-grid">
          <section className="dashboard-panel">
            <div className="section-title">
              <h2>기업별 과정 수</h2>
              <span>막대 클릭 시 과정 표시 예정</span>
            </div>
            <BarList items={companyCounts} />
          </section>

          <section className="dashboard-panel">
            <div className="section-title">
              <h2>교육형태 분포</h2>
              <span>오프라인/비대면/혼합</span>
            </div>
            <DonutChart items={formatCounts} />
          </section>

          <section className="dashboard-panel">
            <div className="section-title">
              <h2>과정 카테고리 소분류</h2>
              <span>{uncategorizedCount > 0 ? `소분류 미입력 ${uncategorizedCount}건 제외` : "소분류 기준 분포"}</span>
            </div>
            <DonutChart items={categoryCounts} />
          </section>

          <section className="dashboard-panel">
            <div className="section-title">
              <h2>OM별 현황</h2>
              <span>담당 운영 수</span>
            </div>
            <BarList items={omCounts} />
          </section>

          <section className="dashboard-panel dashboard-panel-wide">
            <div className="section-title">
              <h2>사용 Tool 분포</h2>
              <span>과정당 다중 선택 합산 (표기가 다를 수 있음)</span>
            </div>
            <BarList items={toolCounts} />
          </section>

          <section className="dashboard-panel dashboard-panel-wide">
            <div className="section-title">
              <h2>월별 과정 현황</h2>
              <span>연간 추이</span>
            </div>
            <MonthlyTrendChart items={monthlyCounts} />
          </section>

          <section className="dashboard-panel dashboard-panel-wide">
            <div className="section-title">
              <h2>이슈 유형별 발생 빈도</h2>
              <span>강의관리에 등록된 이슈 유형 태그 기준, 회차당 다중 선택 합산</span>
            </div>
            <BarList items={issueTagCounts} />
          </section>
        </section>

        <section className="dashboard-panel">
          <div className="section-title">
            <h2>예정 / 진행 운영</h2>
            <div className="dashboard-table-meta">
              <span>{activeOrUpcoming.length}건</span>
              <Link href={`/operations${teamQuery}`}>전체 보기</Link>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>기업 / 과정</th>
                  <th>교육형태</th>
                  <th>OM</th>
                  <th>LD</th>
                  <th>기간</th>
                  <th>매출</th>
                  <th>강사</th>
                </tr>
              </thead>
              <tbody>
                {activeOrUpcoming.slice(0, 10).map((operation) => (
                  <tr key={operation.operationId}>
                    <td>
                      <Link className="course-link" href={`/operations/${operation.operationId}${teamQuery}`}>
                        <strong>{operation.companyName}</strong>
                        <span>{operation.courseName}</span>
                      </Link>
                    </td>
                    <td>{operation.educationFormat}</td>
                    <td>{operation.om || "배정필요"}</td>
                    <td>{operation.ld || "미정"}</td>
                    <td>{operation.startDate} ~ {operation.endDate}</td>
                    <td>{formatShortMoney(operation.revenue ?? 0)}</td>
                    <td>{operation.instructors || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BarList({ items }: { items: Array<{ count: number; label: string }> }) {
  if (items.length === 0) {
    return <p className="dashboard-empty-note">표시할 데이터가 없습니다.</p>;
  }

  const max = Math.max(1, ...items.map((item) => item.count));

  return (
    <div className="bar-list">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <span>{item.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(item.count / max) * 100}%` }} />
          </div>
          <strong>{item.count}</strong>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ items }: { items: Array<{ count: number; label: string }> }) {
  if (items.length === 0) {
    return <p className="dashboard-empty-note">표시할 데이터가 없습니다.</p>;
  }

  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;
  const colors = ["#9fb58d", "#d9caa7", "#aab7bd", "#c8b6a5", "#d7b5aa"];
  const gradient = items
    .map((item, index) => {
      const previous = items.slice(0, index).reduce((sum, current) => sum + current.count, 0);
      const accumulated = previous + item.count;
      const start = (previous / total) * 100;
      const end = (accumulated / total) * 100;
      return `${colors[index % colors.length]} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <div className="donut-wrap">
      <div className="donut-chart" style={{ background: `conic-gradient(${gradient || "#d7e0ea 0% 100%"})` }} />
      <div className="donut-legend">
        {items.map((item, index) => (
          <span key={item.label}>
            <i style={{ background: colors[index % colors.length] }} />
            {item.label} {item.count}
          </span>
        ))}
      </div>
    </div>
  );
}

function MonthlyTrendChart({ items }: { items: Array<{ count: number; label: string }> }) {
  const width = 720;
  const height = 150;
  const padding = { bottom: 28, left: 30, right: 18, top: 18 };
  const maxCount = Math.max(1, ...items.map((item) => item.count));
  const xStep = (width - padding.left - padding.right) / Math.max(1, items.length - 1);
  const points = items.map((item, index) => {
    const x = padding.left + index * xStep;
    const y = padding.top + (1 - item.count / maxCount) * (height - padding.top - padding.bottom);
    return { ...item, x, y };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath = `${path} L ${points.at(-1)?.x ?? padding.left} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;

  return (
    <div className="monthly-trend">
      <svg aria-label="월별 과정 수 추이" role="img" viewBox={`0 0 ${width} ${height}`}>
        <path className="monthly-trend-area" d={areaPath} />
        <path className="monthly-trend-line" d={path} />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="4" />
            <text className="monthly-trend-count" x={point.x} y={point.y - 8}>{point.count}</text>
            <text className="monthly-trend-label" x={point.x} y={height - 8}>{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function isEnded(operation: OperationSession, today: Date) {
  const end = parseDate(operation.endDate);
  return end ? end.getTime() < stripTime(today).getTime() : false;
}

interface CoursePeriod {
  start: Date | null;
  end: Date | null;
}

/** 과정별로 모든 회차를 통틀어 가장 이른 시작일 ~ 가장 늦은 종료일을 구한다. */
function buildCoursePeriods(operations: OperationSession[]): Map<string, CoursePeriod> {
  const periods = new Map<string, CoursePeriod>();

  for (const operation of operations) {
    const key = operation.courseRecordId ?? operation.id;
    const start = parseDate(operation.startDate);
    const end = parseDate(operation.endDate);
    const period = periods.get(key) ?? { start: null, end: null };

    if (start && (!period.start || start.getTime() < period.start.getTime())) period.start = start;
    if (end && (!period.end || end.getTime() > period.end.getTime())) period.end = end;

    periods.set(key, period);
  }

  return periods;
}

function courseStatus(
  operation: OperationSession,
  coursePeriods: Map<string, CoursePeriod>,
  today: Date
): "예정" | "진행중" | "완료" {
  const key = operation.courseRecordId ?? operation.id;
  const period = coursePeriods.get(key);
  const todayTime = stripTime(today).getTime();

  if (period?.start && period.start.getTime() > todayTime) return "예정";
  if (period?.end && period.end.getTime() < todayTime) return "완료";
  return "진행중";
}

function isSameMonth(operation: OperationSession, today: Date) {
  const start = parseDate(operation.startDate);
  return start ? start.getFullYear() === today.getFullYear() && start.getMonth() === today.getMonth() : false;
}

function isSameYear(operation: OperationSession, today: Date) {
  const start = parseDate(operation.startDate);
  return start ? start.getFullYear() === today.getFullYear() : false;
}

function parseDate(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function stripTime(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function splitToolsList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function resolveOperationOmPart(operation: OperationSession, omPartByName: Map<string, string>): string | undefined {
  const names = splitPersonNames(operation.om, "");
  for (const name of names) {
    const part = omPartByName.get(name.trim());
    if (part) return part;
  }
  return undefined;
}

function dedupeByCourse(operations: OperationSession[]): OperationSession[] {
  const seen = new Set<string>();
  const courses: OperationSession[] = [];

  for (const operation of operations) {
    const key = operation.courseRecordId ?? operation.id;
    if (seen.has(key)) continue;
    seen.add(key);
    courses.push(operation);
  }

  return courses;
}

function topCounts(values: string[], limit: number) {
  const counts = new Map<string, number>();

  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || compareStableText(a.label, b.label))
    .slice(0, limit);
}

function compareStableText(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function monthlySeries(operations: OperationSession[], year: number) {
  return Array.from({ length: 12 }, (_, index) => {
    const label = `${index + 1}월`;
    const monthOperations = operations.filter((operation) => {
      const date = parseDate(operation.startDate);
      return date ? date.getFullYear() === year && date.getMonth() === index : false;
    });

    return { count: dedupeByCourse(monthOperations).length, label };
  });
}

function formatShortMoney(value: number): string {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (value >= 10000) return `${Math.round(value / 10000).toLocaleString("ko-KR")}만`;
  return value.toLocaleString("ko-KR");
}
