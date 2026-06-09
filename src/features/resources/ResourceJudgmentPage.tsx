"use client";

import Link from "next/link";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { OperationSession, OperationStatus } from "@/lib/data/operationTypes";

const BOARD_GROUPS: Array<{ label: string; statuses: OperationStatus[] }> = [
  { label: "시작 전", statuses: ["배정필요", "배정예정"] },
  { label: "진행 중", statuses: ["진행중"] },
  { label: "완료", statuses: ["완료", "회고완료", "아카이빙필요"] }
];

interface ResourceJudgmentPageProps {
  operations: OperationSession[];
}

interface CalendarDay {
  date: Date;
  inMonth: boolean;
  operations: OperationSession[];
}

export function ResourceJudgmentPage({ operations }: ResourceJudgmentPageProps) {
  const [viewDate, setViewDate] = useState(new Date());
  const calendarDays = buildCalendarDays(viewDate, operations);
  const monthLabel = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    year: "numeric"
  }).format(viewDate);
  const omGroups = groupByOwner(operations);
  const boardStyle = { "--owner-count": omGroups.length } as CSSProperties;

  return (
    <main className="dashboard-shell">
      <aside className="sidebar" aria-label="hub-om 메뉴">
        <div className="brand">
          <span className="brand-mark">OD</span>
          <div>
            <strong>hub-om</strong>
            <span>Resource view</span>
          </div>
        </div>
        <nav className="nav-list">
          <Link href="/">대시보드</Link>
          <Link href="/operations">운영 현황</Link>
          <Link className="active" href="/resources">리소스 판단</Link>
        </nav>
      </aside>

      <section className="content">
        <header className="page-header">
          <div>
            <h1>리소스 판단</h1>
            <p className="lede">
              달력과 OM별 운영 보드를 함께 보며 실제 추가 배정 가능 여부를 확인합니다.
            </p>
          </div>
        </header>

        <section className="resource-section">
          <div className="section-title">
            <h2>{monthLabel} 달력</h2>
            <div className="month-controls">
              <button type="button" onClick={() => setViewDate(shiftMonth(viewDate, -1))}>이전</button>
              <button type="button" onClick={() => setViewDate(new Date())}>오늘</button>
              <button type="button" onClick={() => setViewDate(shiftMonth(viewDate, 1))}>다음</button>
            </div>
          </div>
          <div className="calendar-grid" aria-label={`${monthLabel} 운영 달력`}>
            {["월", "화", "수", "목", "금", "토", "일"].map((day) => (
              <div className="calendar-weekday" key={day}>{day}</div>
            ))}
            {calendarDays.map((day) => (
              <div className={`calendar-day ${day.inMonth ? "" : "muted-day"}`} key={day.date.toISOString()}>
                <span className="calendar-date">{day.date.getDate()}</span>
                <div className="calendar-events">
                  {day.operations.slice(0, 4).map((operation) => (
                    <Link className="calendar-event" href={`/operations/${operation.operationId}`} key={operation.operationId}>
                      <strong>{operation.courseName}</strong>
                      <span>{operation.om || "배정필요"} · {operation.onsiteText || "현장 확인"}</span>
                    </Link>
                  ))}
                  {day.operations.length > 4 ? <span className="event-overflow">+{day.operations.length - 4}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="resource-section">
          <div className="section-title">
            <h2>운영 현황 보드</h2>
            <span>OM별 시작 전 / 진행 중 / 완료 그룹</span>
          </div>
          <div className="resource-swimlane-board" style={boardStyle}>
            <div className="resource-board-header">
              <div className="resource-status-spacer" aria-hidden="true" />
              {omGroups.map((group) => (
                <div className="resource-owner-header" key={group.owner}>
                  <h3>{group.owner}</h3>
                  <span>{group.operations.length}건</span>
                </div>
              ))}
            </div>
            {BOARD_GROUPS.map((boardGroup) => {
              const laneTotal = omGroups.reduce(
                (total, group) =>
                  total +
                  group.operations.filter((operation) =>
                    boardGroup.statuses.includes(operation.operationStatus)
                  ).length,
                0
              );

              return (
                <section className="resource-status-lane" key={boardGroup.label}>
                  <div className="resource-lane-label">
                    <span>{boardGroup.label}</span>
                    <strong>{laneTotal}건</strong>
                  </div>
                  {omGroups.map((group) => {
                    const groupOperations = group.operations.filter((operation) =>
                      boardGroup.statuses.includes(operation.operationStatus)
                    );

                    return (
                      <div className="resource-lane-cell" key={`${boardGroup.label}-${group.owner}`}>
                      <div className="resource-card-list">
                        {groupOperations.map((operation) => (
                          <Link className="resource-card" href={`/operations/${operation.operationId}`} key={operation.operationId}>
                            <span className="resource-status">{operation.operationStatus}</span>
                            <strong>{operation.courseName}</strong>
                            <span>{operation.startDate} ~ {operation.endDate}</span>
                            <span>{operation.operationType} · {operation.educationFormat}</span>
                            <span>{resourceLoadLabel(operation)} · {nearbyLabel(operation, operations)}</span>
                            <span>부재 일정: Google Calendar 연동 전</span>
                          </Link>
                        ))}
                      </div>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

function buildCalendarDays(anchorDate: Date, operations: OperationSession[]): CalendarDay[] {
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const endOffset = 6 - ((lastDay.getDay() + 6) % 7);
  const start = new Date(year, month, 1 - startOffset);
  const totalDays = startOffset + lastDay.getDate() + endOffset;

  return Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      date,
      inMonth: date.getMonth() === month,
      operations: operations.filter((operation) => includesDate(operation, date))
    };
  });
}

function includesDate(operation: OperationSession, date: Date) {
  const start = parseDate(operation.startDate);
  const end = parseDate(operation.endDate);

  if (!start || !end) return false;

  return start.getTime() <= date.getTime() && date.getTime() <= end.getTime();
}

function parseDate(value: string) {
  if (!value) return null;

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shiftMonth(value: Date, offset: number) {
  return new Date(value.getFullYear(), value.getMonth() + offset, 1);
}

function groupByOwner(operations: OperationSession[]) {
  const sorted = [...operations].sort((a, b) => compareStableText(a.startDate, b.startDate));
  const groups = new Map<string, OperationSession[]>();

  for (const operation of sorted) {
    const owner = operation.om || "배정필요";
    groups.set(owner, [...(groups.get(owner) ?? []), operation]);
  }

  return Array.from(groups.entries()).map(([owner, ownerOperations]) => ({
    owner,
    operations: ownerOperations
  }));
}

function compareStableText(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function isLargeCourse(operation: OperationSession) {
  return ["장기", "상시형", "준장기", "연간"].includes(operation.operationType) || operation.onsiteRequired === "Y";
}

function resourceLoadLabel(operation: OperationSession) {
  if (isLargeCourse(operation)) return "리소스 크게 비워야 함";
  if (operation.operationType === "특강") return "단기 투입 가능";
  return "일반 투입";
}

function nearbyLabel(operation: OperationSession, operations: OperationSession[]) {
  const start = parseDate(operation.startDate);
  if (!start) return "주변 일정 확인 필요";

  const count = operations.filter((candidate) => {
    if (candidate.operationId === operation.operationId || candidate.om !== operation.om) return false;
    const candidateStart = parseDate(candidate.startDate);
    if (!candidateStart) return false;
    const diff = Math.abs(candidateStart.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    return diff <= 7;
  }).length;

  return count > 0 ? `근처 일정 ${count}건` : "근처 일정 없음";
}
