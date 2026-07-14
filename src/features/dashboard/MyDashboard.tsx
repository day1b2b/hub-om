"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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

export function MyDashboard({ assignedRequests, omName, operations }: MyDashboardProps) {
  const today = useMemo(() => new Date(), []);
  const [monthView, setMonthView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));

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

  // 요약·분석은 선택한 달 기준(맨 위 화살표로 전월/차월 이동).
  function moveMonth(delta: number) {
    setMonthView((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }
  const scopedOperations = operations.filter((operation) => {
    const start = parseDate(operation.startDate);
    return start ? start.getFullYear() === monthView.year && start.getMonth() === monthView.month : false;
  });
  // 나의 담당 과정도 선택한 달에 진행되는 것만(세션 기간이 그 달과 겹치는 요청).
  const monthStartTime = stripTime(new Date(monthView.year, monthView.month, 1)).getTime();
  const monthEndTime = stripTime(new Date(monthView.year, monthView.month + 1, 0)).getTime();
  const monthAssignedRequests = assignedRequests.filter((request) => {
    const range = scheduleRange(request);
    const start = parseDate(range.start);
    const end = parseDate(range.end) ?? start;
    if (!start || !end) return false;
    return stripTime(start).getTime() <= monthEndTime && stripTime(end).getTime() >= monthStartTime;
  });
  // 담당 과정 표는 전체를 시작일 순으로 다 보여주고, 선택한 달에 진행되는 건만 강조한다.
  const sortedAssignedRequests = [...assignedRequests].sort((a, b) =>
    scheduleRange(a).start.localeCompare(scheduleRange(b).start)
  );
  const focusRequestIds = new Set(monthAssignedRequests.map((request) => request.id));
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

  // 캘린더는 운영 + 나의 담당 과정을 모두 반영한다(담당 과정에 새 과정이 추가되면 캘린더에도 자동 표시).
  const calendarEvents: CalendarEvent[] = [
    ...operations.flatMap((operation) => {
      const start = parseDate(operation.startDate);
      const end = parseDate(operation.endDate) ?? start;
      if (!start || !end) return [];
      return [{
        id: `op-${operation.operationId}`,
        label: operation.companyName,
        course: operation.courseName,
        start: stripTime(start),
        end: stripTime(end),
        href: `/operations/${operation.operationId}`
      }];
    }),
    ...assignedRequests.flatMap((request) => {
      const range = scheduleRange(request);
      const start = parseDate(range.start);
      const end = parseDate(range.end) ?? start;
      if (!start || !end) return [];
      return [{
        id: `req-${request.id}`,
        label: request.company,
        course: request.courseName,
        start: stripTime(start),
        end: stripTime(end),
        href: `/om-request/manage/${request.id}`
      }];
    })
  ];

  // 파이프라인: 운영은 상태별 단계로, 나의 담당 과정(배정 요청)은 아직 진행 전이라 사전세팅에 합산.
  const pipeline = PIPELINE_LABELS.map((label) => {
    const operationCount = scopedOperations.filter((operation) => operationPhase(operation.operationStatus) === label).length;
    const requestCount = label === "사전세팅" ? monthAssignedRequests.length : 0;
    return { label, count: operationCount + requestCount };
  });
  const maxPipeline = Math.max(1, ...pipeline.map((item) => item.count));
  // 다음 과정 D-day: 운영 + 담당 과정을 모두 고려해 가장 임박한 것을 찾는다.
  const nextEvent = findNextEvent(calendarEvents, today);
  const nextEventDday = nextEvent ? daysBetween(today, nextEvent.start) : null;

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
        </header>

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
              <span>전체 {sortedAssignedRequests.length}건 · {monthView.month + 1}월 {focusRequestIds.size}건</span>
              <div className="me-cal-nav" aria-label="월 이동">
                <button aria-label="이전 달" onClick={() => moveMonth(-1)} type="button">‹</button>
                <strong>{monthView.year}년 {monthView.month + 1}월</strong>
                <button aria-label="다음 달" onClick={() => moveMonth(1)} type="button">›</button>
              </div>
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
                </tr>
              </thead>
              <tbody>
                {sortedAssignedRequests.length > 0 ? (
                  sortedAssignedRequests.map((request) => {
                    const schedule = scheduleRange(request);
                    return (
                      <tr className={focusRequestIds.has(request.id) ? "me-focus-row" : ""} key={request.id}>
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
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={6}>
                      <strong>배정된 담당 과정이 없습니다.</strong>
                      <span>업무 요청 후 담당으로 배정되면 여기에 표시됩니다.</span>
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
              <PanelEmpty label={`${monthView.year}년 ${monthView.month + 1}월에 표시할 운영이 없습니다`} />
            )}
          </section>

          <section className="dashboard-panel">
            <div className="section-title">
              <h2>다음 과정 D-day</h2>
              <span>가장 임박한 예정 과정</span>
            </div>
            {nextEvent ? (
              <div className="dday-card">
                <strong className="dday-badge">{nextEventDday === 0 ? "D-DAY" : `D-${nextEventDday}`}</strong>
                <Link className="course-link" href={nextEvent.href}>
                  <strong>{nextEvent.label}</strong>
                  <span>{nextEvent.course}</span>
                </Link>
                <span className="dday-date">{formatDateText(nextEvent.start)} 시작</span>
              </div>
            ) : (
              <PanelEmpty label="예정된 과정이 없습니다" />
            )}
          </section>
        </section>

        <MonthlyCalendar events={calendarEvents} today={today} />

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

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface CalendarEvent {
  id: string;
  label: string;
  course: string;
  start: Date;
  end: Date;
  href: string;
}

// 내 과정이 언제 진행되는지 월별 달력으로 보여준다. 운영과 담당 과정을 모두 반영한다.
// 여러 날에 걸치는 과정은 시작일~종료일까지 칸을 가로지르는 하나의 막대(bar)로 쭉 이어서 표시한다.
function MonthlyCalendar({ events, today }: { events: CalendarEvent[]; today: Date }) {
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));

  const monthStart = new Date(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const leadingBlanks = monthStart.getDay();
  const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;
  const todayKey = dateKey(stripTime(today));

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
          const { bars, laneCount } = buildWeekBars(week, events);
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
                    href={bar.event.href}
                    key={bar.event.id}
                    style={{ gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`, gridRow: bar.lane + 1 }}
                    title={`${bar.event.label} · ${bar.event.course}`}
                  >
                    {bar.event.label}
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
  events: CalendarEvent[]
) {
  const weekStart = stripTime(week[0].date).getTime();
  const weekEnd = stripTime(week[6].date).getTime();

  const segments = events
    .filter((event) => event.start.getTime() <= weekEnd && event.end.getTime() >= weekStart)
    .map((event) => {
      const segStart = Math.max(event.start.getTime(), weekStart);
      const segEnd = Math.min(event.end.getTime(), weekEnd);
      return {
        event,
        startCol: week.findIndex((cell) => stripTime(cell.date).getTime() === segStart),
        endCol: week.findIndex((cell) => stripTime(cell.date).getTime() === segEnd),
        isStart: event.start.getTime() >= weekStart,
        isEnd: event.end.getTime() <= weekEnd
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

function parseDate(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function stripTime(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

// 오늘 이후 시작하는 과정(운영 + 담당 과정) 중 가장 임박한 것을 찾는다.
function findNextEvent(events: CalendarEvent[], today: Date): CalendarEvent | null {
  const todayTime = stripTime(today).getTime();
  let best: CalendarEvent | null = null;

  for (const event of events) {
    const time = event.start.getTime();
    if (time >= todayTime && (!best || time < best.start.getTime())) {
      best = event;
    }
  }

  return best;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((stripTime(to).getTime() - stripTime(from).getTime()) / (1000 * 60 * 60 * 24));
}

function formatDateText(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatToday(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}
