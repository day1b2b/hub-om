"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";
import type { OperationSession, OperationStatus } from "@/lib/data/operationTypes";

interface MyDashboardProps {
  // 로그인 계정이 명단(team-users.json)에 없으면 null.
  omName: null | string;
  // 이미 내 담당으로 필터된 운영 목록.
  operations: OperationSession[];
  // 나에게 배정된 OM 운영 요청.
  assignedRequests: OmRequest[];
}

type DashboardScope = "이번달" | "연간";

export function MyDashboard({ assignedRequests, omName, operations }: MyDashboardProps) {
  const today = useMemo(() => new Date(), []);
  const [scope, setScope] = useState<DashboardScope>("이번달");

  if (!omName) {
    return (
      <main className="dashboard-shell">
        <AppSidebar label="My" teamScope="both" />
        <section className="content dashboard-page">
          <header className="page-header">
            <div>
              <p className="eyebrow">내 대시보드</p>
              <h1>내 대시보드</h1>
              <p className="lede">로그인한 계정이 OM 명단에 등록되어 있지 않습니다.</p>
            </div>
          </header>
          <section className="dashboard-panel">
            <div className="empty-state">
              <strong>명단에 등록된 계정이 아닙니다.</strong>
              <span>관리자에게 OM 명단 등록을 요청하세요. (관리자 전용 → 사용자 관리)</span>
            </div>
          </section>
        </section>
      </main>
    );
  }

  // 요약은 기간 토글(이번달/연간)로 좁힌다.
  const scopedOperations = operations.filter((operation) =>
    scope === "이번달" ? isSameMonth(operation, today) : isSameYear(operation, today)
  );
  const active = scopedOperations.filter((operation) => operation.operationStatus === "진행중").length;
  const upcoming = scopedOperations.filter((operation) => isUpcoming(operation, today)).length;
  const done = scopedOperations.filter(isDone).length;

  // 내 할 일(밀린 작업)은 기간과 무관하게 전체 기준으로 센다. 지난달 미완 항목이 숨지 않도록.
  const pendingRetrospective = operations.filter((operation) => operation.operationStatus === "완료").length;
  const needsArchive = operations.filter(
    (operation) => operation.archiveStatus === "아카이빙필요" || operation.operationStatus === "아카이빙필요"
  ).length;
  const missingSatisfaction = operations.filter(
    (operation) => isDone(operation) && operation.avgSatisfaction.trim() === ""
  ).length;
  const missingResultReport = operations.filter(
    (operation) => isDone(operation) && operation.hasResultReport === "확인필요"
  ).length;
  const hasIssue = operations.filter((operation) => operation.operationIssue.trim() !== "").length;
  const operationsWithLinks = operations.filter((operation) => operationLinks(operation).length > 0);

  // 시각화(분석)도 기간 토글을 따른다.
  const pipeline = PIPELINE_LABELS.map((label) => ({
    label,
    count: scopedOperations.filter((operation) => operationPhase(operation.operationStatus) === label).length
  }));
  const maxPipeline = Math.max(1, ...pipeline.map((item) => item.count));
  const nextCourse = findNextCourse(operations, today);
  const nextCourseDday = nextCourse ? daysUntil(nextCourse.startDate, today) : null;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="My" teamScope="both" />

      <section className="content dashboard-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">{formatToday(today)} 기준</p>
            <h1>내 대시보드</h1>
            <p className="lede">{omName}님이 담당한 운영 현황과 지금 챙겨야 할 일을 모아 봅니다.</p>
          </div>
          <div className="header-panel">
            <span>데이터 기준</span>
            <strong>{scope} 현황</strong>
          </div>
        </header>

        <div className="dashboard-controls" aria-label="대시보드 필터">
          <div className="dashboard-tabs" role="group" aria-label="기간 범위">
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
        </div>

        <section className="metrics" aria-label="내 운영 요약">
          <Metric label="전체" value={scopedOperations.length} />
          <Metric label="진행중" value={active} />
          <Metric label="예정" value={upcoming} />
          <Metric label="완료" value={done} />
        </section>

        <section className="dashboard-panel">
          <div className="section-title">
            <h2>나의 담당 과정</h2>
            <div className="dashboard-table-meta">
              <span>{assignedRequests.length}건</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>기업 / 과정</th>
                  <th>교육형태</th>
                  <th>시작일</th>
                  <th>종료일</th>
                  <th>총 회차</th>
                  <th>LD</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {assignedRequests.length > 0 ? (
                  assignedRequests.map((request) => (
                    <AssignedCourseRow key={request.id} request={request} />
                  ))
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={7}>
                      <strong>배정된 과정이 없습니다.</strong>
                      <span>운영 요청이 나에게 배정되면 여기에 표시됩니다.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="dashboard-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <section className="dashboard-panel">
            <div className="section-title">
              <h2>내 운영 파이프라인</h2>
              <span>단계별 건수</span>
            </div>
            {scopedOperations.length > 0 ? (
              <div className="bar-list">
                {pipeline.map((item) => (
                  <div className="bar-row" key={item.label}>
                    <span>{item.label}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(item.count / maxPipeline) * 100}%` }} />
                    </div>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <PanelEmpty label={`${scope}에 표시할 운영이 없습니다`} />
            )}
          </section>

          <section className="dashboard-panel">
            <div className="section-title">
              <h2>다음 과정 D-day</h2>
              <span>가장 임박한 예정 과정</span>
            </div>
            {nextCourse ? (
              <div className="dday-card">
                <strong className="dday-badge">{nextCourseDday === 0 ? "D-DAY" : `D-${nextCourseDday}`}</strong>
                <Link className="course-link" href={`/operations/${nextCourse.operationId}`}>
                  <strong>{nextCourse.companyName}</strong>
                  <span>{nextCourse.courseName}</span>
                </Link>
                <span className="dday-date">{nextCourse.startDate} 시작</span>
              </div>
            ) : (
              <PanelEmpty label="예정된 과정이 없습니다" />
            )}
          </section>
        </section>

        <MonthlyCalendar operations={operations} today={today} />

        <section className="dashboard-panel">
          <div className="section-title">
            <h2>내 할 일</h2>
            <span>전체 기간 기준</span>
          </div>
          <div className="metrics" aria-label="내 할 일">
            <Metric label="운영이슈" value={hasIssue} />
            <Metric label="회고 대기" value={pendingRetrospective} />
            <Metric label="아카이빙필요" value={needsArchive} />
            <Metric label="만족도 미확인" value={missingSatisfaction} />
            <Metric label="결과보고서 미확인" value={missingResultReport} />
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="section-title">
            <h2>내 운영 자료 바로가기</h2>
            <span>{operationsWithLinks.length}건</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>기업 / 과정</th>
                  <th>자료</th>
                </tr>
              </thead>
              <tbody>
                {operationsWithLinks.length > 0 ? (
                  operationsWithLinks.map((operation) => (
                    <tr key={operation.operationId}>
                      <td>
                        <Link className="course-link" href={`/operations/${operation.operationId}`}>
                          <strong>{operation.companyName}</strong>
                          <span>{operation.courseName}</span>
                        </Link>
                      </td>
                      <td>
                        {operationLinks(operation).map((link, index) => (
                          <span key={link.label}>
                            {index > 0 ? " · " : null}
                            <a href={link.url} rel="noreferrer" target="_blank">{link.label}</a>
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={2}>
                      <strong>등록된 자료 링크가 없습니다.</strong>
                      <span>운영에 Drive·강의관리·결과보고서 링크가 등록되면 여기에 모입니다.</span>
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

const PIPELINE_LABELS = ["사전세팅", "현장 운영", "결과"] as const;

// 진행중 = 현장 운영, 완료·회고완료·아카이빙필요 = 결과.
// 그 외(배정필요·배정예정 등 현장에 나가기 전 단계)는 모두 사전세팅으로 묶는다.
function operationPhase(status: OperationStatus): (typeof PIPELINE_LABELS)[number] {
  if (status === "진행중") return "현장 운영";
  if (status === "완료" || status === "회고완료" || status === "아카이빙필요") return "결과";
  return "사전세팅";
}

function PanelEmpty({ label = "표시할 데이터가 없습니다" }: { label?: string }) {
  return (
    <div className="empty-state">
      <strong>{label}</strong>
    </div>
  );
}

// 배정된 과정 한 건의 표 행. 과정별 회고 메모를 펼쳐서 쓸 수 있고,
// 메모는 서버가 아니라 이 브라우저(localStorage)에 과정 id별로 보관한다.
// 저장은 입력 이벤트에서 디바운스로 처리해 effect 안 setState를 쓰지 않는다.
function AssignedCourseRow({ request }: { request: OmRequest }) {
  const schedule = scheduleRange(request);
  const memoKey = `hub-om:course-memo:${request.id}`;
  const [open, setOpen] = useState(false);
  const [memo, setMemo] = useState(() => readMemo(memoKey));
  const [saved, setSaved] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMemo = memo.trim().length > 0;

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setMemo(value);
    setSaved(false);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(memoKey, value);
        setSaved(true);
      } catch {
        // 저장 실패는 조용히 무시한다(개인 메모라 치명적이지 않음).
      }
    }, 500);
  }

  return (
    <>
      <tr>
        <td>
          <Link className="course-link" href={`/om-request/manage/${request.id}`}>
            <strong>{request.company}</strong>
            <span>{request.courseName}</span>
          </Link>
        </td>
        <td>{request.trainingType}</td>
        <td>{schedule.start}</td>
        <td>{schedule.end}</td>
        <td>{request.totalSessions}회</td>
        <td>{request.ld || "-"}</td>
        <td>
          <button
            aria-expanded={open}
            className={hasMemo ? "memo-toggle has-memo" : "memo-toggle"}
            onClick={() => setOpen((value) => !value)}
            suppressHydrationWarning
            type="button"
          >
            {hasMemo ? "메모 ●" : "메모"} {open ? "▲" : "▾"}
          </button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td className="course-memo-cell" colSpan={7}>
            <div className="course-memo">
              <textarea
                aria-label={`${request.courseName} 회고 메모`}
                onChange={handleChange}
                placeholder="이 과정에서 잘된 점, 아쉬운 점, 다음에 시도할 것을 기록하세요."
                value={memo}
              />
              <span className="course-memo-status">{saved ? "저장됨 · 이 브라우저에만 보관" : "저장 중…"}</span>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function readMemo(storageKey: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 내 과정이 언제 진행되는지 월별 달력으로 보여준다.
// 여러 날에 걸치는 과정은 시작일~종료일까지 칸을 가로지르는 하나의 막대(bar)로 쭉 이어서 표시한다.
function MonthlyCalendar({ operations, today }: { operations: OperationSession[]; today: Date }) {
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));

  const monthStart = new Date(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const leadingBlanks = monthStart.getDay();
  const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;
  const todayKey = dateKey(stripTime(today));

  const ranges = operations.flatMap((operation) => {
    const start = parseDate(operation.startDate);
    const end = parseDate(operation.endDate) ?? start;
    if (!start || !end) return [];
    return [{ operation, start: stripTime(start), end: stripTime(end) }];
  });

  const cells = Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - leadingBlanks + 1;
    const date = new Date(view.year, view.month, dayNumber);
    return { date, dayNumber, inMonth: dayNumber >= 1 && dayNumber <= daysInMonth };
  });
  const weeks = Array.from({ length: totalCells / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));

  function moveMonth(delta: number) {
    setView((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  return (
    <section className="dashboard-panel">
      <div className="section-title">
        <h2>내 과정 일정</h2>
        <div className="me-cal-nav">
          <button aria-label="이전 달" onClick={() => moveMonth(-1)} type="button">‹</button>
          <strong>{view.year}년 {view.month + 1}월</strong>
          <button aria-label="다음 달" onClick={() => moveMonth(1)} type="button">›</button>
        </div>
      </div>
      <div className="me-calendar">
        <div className="me-cal-weekdays">
          {WEEKDAYS.map((label) => (
            <div className="me-cal-weekday" key={label}>{label}</div>
          ))}
        </div>
        {weeks.map((week, weekIndex) => {
          const { bars, laneCount } = buildWeekBars(week, ranges);
          return (
            <div className="me-cal-week" key={weekIndex} style={{ height: Math.max(116, 34 + laneCount * 23) }}>
              <div className="me-cal-week-cells">
                {week.map((cell, cellIndex) => (
                  <div
                    className={[
                      "me-cal-day",
                      cell.inMonth ? "" : "is-other-month",
                      cell.inMonth && dateKey(cell.date) === todayKey ? "is-today" : ""
                    ].filter(Boolean).join(" ")}
                    key={cellIndex}
                  >
                    {cell.inMonth ? <span className="me-cal-daynum">{cell.dayNumber}</span> : null}
                  </div>
                ))}
              </div>
              <div className="me-cal-week-bars">
                {bars.map((bar) => (
                  <a
                    className={["me-cal-bar", bar.isStart ? "is-start" : "", bar.isEnd ? "is-end" : ""].filter(Boolean).join(" ")}
                    href={`/operations/${bar.operation.operationId}`}
                    key={bar.operation.operationId}
                    style={{ gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`, gridRow: bar.lane + 1 }}
                    title={`${bar.operation.companyName} · ${bar.operation.courseName} (${bar.operation.startDate} ~ ${bar.operation.endDate})`}
                  >
                    {bar.operation.companyName}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// 한 주에서 각 과정이 차지하는 열(시작~끝)과 겹침 방지 레인을 계산한다.
function buildWeekBars(
  week: Array<{ date: Date; dayNumber: number; inMonth: boolean }>,
  ranges: Array<{ operation: OperationSession; start: Date; end: Date }>
) {
  const weekStart = stripTime(week[0].date).getTime();
  const weekEnd = stripTime(week[6].date).getTime();

  const segments = ranges
    .filter((range) => range.start.getTime() <= weekEnd && range.end.getTime() >= weekStart)
    .map((range) => {
      const segStart = Math.max(range.start.getTime(), weekStart);
      const segEnd = Math.min(range.end.getTime(), weekEnd);
      return {
        operation: range.operation,
        startCol: week.findIndex((cell) => stripTime(cell.date).getTime() === segStart),
        endCol: week.findIndex((cell) => stripTime(cell.date).getTime() === segEnd),
        isStart: range.start.getTime() >= weekStart,
        isEnd: range.end.getTime() <= weekEnd
      };
    })
    .sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));

  const laneEnds: number[] = [];
  const bars = segments.map((segment) => {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] >= segment.startCol) lane += 1;
    laneEnds[lane] = segment.endCol;
    return { ...segment, lane };
  });

  return { bars, laneCount: Math.max(1, laneEnds.length) };
}

// 배정 요청 세션들에서 처음 시작일과 마지막 종료일을 뽑는다. (날짜가 YYYY-MM-DD라 사전순=시간순)
function scheduleRange(request: OmRequest): { start: string; end: string } {
  const dates = request.sessions.map((session) => session.date).filter(Boolean).sort();
  if (dates.length === 0) return { start: "-", end: "-" };

  return { start: dates[0], end: dates[dates.length - 1] };
}

// 운영에 등록된 자료 링크만 모은다.
function operationLinks(operation: OperationSession): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  if (operation.driveLink) links.push({ label: "Drive", url: operation.driveLink });
  if (operation.lectureManagementLink) links.push({ label: "강의관리", url: operation.lectureManagementLink });
  if (operation.resultReportLink) links.push({ label: "결과보고서", url: operation.resultReportLink });
  if (operation.padletLink) links.push({ label: "Padlet", url: operation.padletLink });
  if (operation.companyWikiLink) links.push({ label: "기업위키", url: operation.companyWikiLink });
  return links;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isUpcoming(operation: OperationSession, today: Date) {
  const start = parseDate(operation.startDate);
  return start ? start.getTime() > stripTime(today).getTime() : false;
}

function isDone(operation: OperationSession) {
  return operation.operationStatus === "완료" || operation.operationStatus === "회고완료";
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
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function stripTime(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

// 오늘 이후 시작하는 내 운영 중 가장 임박한 것을 찾는다.
function findNextCourse(operations: OperationSession[], today: Date): OperationSession | null {
  const todayTime = stripTime(today).getTime();
  let best: OperationSession | null = null;
  let bestTime = Infinity;

  for (const operation of operations) {
    const start = parseDate(operation.startDate);
    if (!start) continue;

    const time = stripTime(start).getTime();
    if (time >= todayTime && time < bestTime) {
      bestTime = time;
      best = operation;
    }
  }

  return best;
}

function daysUntil(dateValue: string, today: Date): number {
  const date = parseDate(dateValue);
  if (!date) return 0;

  return Math.round((stripTime(date).getTime() - stripTime(today).getTime()) / (1000 * 60 * 60 * 24));
}

function formatToday(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}
