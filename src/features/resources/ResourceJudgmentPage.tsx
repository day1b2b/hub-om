"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import type { OperationSession, OperationStatus, SourceTeam } from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";
import type { ResourceOwnerRoster } from "@/lib/data/teamMemberRepository";

const BOARD_GROUPS: Array<{ label: string; statuses: OperationStatus[] }> = [
  { label: "시작 전", statuses: ["배정필요", "배정예정"] },
  { label: "진행 중", statuses: ["진행중"] },
  { label: "완료", statuses: ["완료", "회고완료", "아카이빙필요"] }
];

const STATUS_TONE: Record<OperationStatus, string> = {
  "배정필요": "amber",
  "배정예정": "amber",
  "진행중": "blue",
  "완료": "gray",
  "회고완료": "gray",
  "아카이빙필요": "pink"
};

const OWNER_TONES = ["green", "amber", "pink", "purple", "blue", "gray"] as const;
const TEAM_FILTERS = ["전체", "1팀", "2팀", "미분류"] as const;
const MAX_CALENDAR_CONTINUOUS_DAYS = 31;
const MAX_CALENDAR_EVENT_LANES = 3;
const MAX_BOARD_CARDS_PER_LANE = 4;

interface ResourceJudgmentPageProps {
  operations: OperationSession[];
  ownerRoster?: ResourceOwnerRoster;
}

interface CalendarDay {
  date: Date;
  inMonth: boolean;
}

interface CalendarWeek {
  days: CalendarDay[];
  key: string;
  segments: CalendarEventSegment[];
}

interface CalendarEventSegment {
  endsAfterWeek: boolean;
  key: string;
  lane: number;
  longSummary: boolean;
  operation: OperationSession;
  span: number;
  startColumn: number;
  startsBeforeWeek: boolean;
}

export function ResourceJudgmentPage({ operations, ownerRoster = {} }: ResourceJudgmentPageProps) {
  const [viewDate, setViewDate] = useState(new Date());
  const [teamFilter, setTeamFilter] = useState<(typeof TEAM_FILTERS)[number]>("전체");
  const [ownerFilter, setOwnerFilter] = useState("전체 담당자");
  const [expandedCalendarDays, setExpandedCalendarDays] = useState<Set<string>>(() => new Set());
  const [expandedBoardLanes, setExpandedBoardLanes] = useState<Set<string>>(() => new Set());
  const teamOperations = useMemo(
    () => operations.filter((operation) => teamFilter === "전체" || getSourceTeam(operation) === teamFilter),
    [operations, teamFilter]
  );
  const rosterOwners = useMemo(() => getRosterOwners(ownerRoster, teamFilter), [ownerRoster, teamFilter]);
  const ownerOptions = useMemo(
    () => ["전체 담당자", ...unique([...rosterOwners, ...getAssignmentNeededOption(teamOperations, rosterOwners)])],
    [rosterOwners, teamOperations]
  );
  const resourceOwnerSet = useMemo(() => new Set(ownerOptions.slice(1)), [ownerOptions]);
  const effectiveOwnerFilter = ownerOptions.includes(ownerFilter) ? ownerFilter : "전체 담당자";
  const filteredOperations = useMemo(
    () =>
      teamOperations.filter(
        (operation) =>
          effectiveOwnerFilter === "전체 담당자" ||
          getResourceOwners(operation.om, resourceOwnerSet).includes(effectiveOwnerFilter)
      ),
    [effectiveOwnerFilter, resourceOwnerSet, teamOperations]
  );
  const calendarOperations = useMemo(
    () => filteredOperations.filter((operation) => isInCalendarWindow(operation, viewDate)),
    [filteredOperations, viewDate]
  );
  const boardOperations = useMemo(
    () => filteredOperations.filter((operation) => isInBoardWindow(operation, viewDate)),
    [filteredOperations, viewDate]
  );
  const calendarWeeks = buildCalendarWeeks(viewDate, calendarOperations);
  const monthLabel = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    year: "numeric"
  }).format(viewDate);
  const boardOwners = effectiveOwnerFilter === "전체 담당자" ? ownerOptions.slice(1) : [effectiveOwnerFilter];
  const omGroups = groupByOwner(boardOperations, boardOwners, resourceOwnerSet);

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
          <Link className="active" href="/resources">리소스</Link>
        </nav>
      </aside>

      <section className="content resource-content">
        <header className="resource-page-header">
          <div>
            <h1>리소스</h1>
            <p className="lede">
              달력과 OM별 운영 보드를 함께 보며 실제 추가 배정 가능 여부를 확인합니다.
            </p>
          </div>
        </header>

        <section className="resource-section compact-resource-section">
          <div className="section-title resource-section-title">
            <div className="resource-title-heading">
              <h2>{monthLabel}</h2>
              <div className="month-controls">
                <button type="button" onClick={() => updateViewDate(shiftMonth(viewDate, -1))}>이전</button>
                <button type="button" onClick={() => updateViewDate(new Date())}>오늘</button>
                <button type="button" onClick={() => updateViewDate(shiftMonth(viewDate, 1))}>다음</button>
              </div>
            </div>
            <div className="resource-title-actions">
              <div className="team-tabs" role="group" aria-label="팀 선택">
                {TEAM_FILTERS.map((team) => (
                  <button
                    aria-pressed={teamFilter === team}
                    className={teamFilter === team ? "selected" : ""}
                    key={team}
                    onClick={() => {
                      setTeamFilter(team);
                      collapseExpandedItems();
                    }}
                    type="button"
                  >
                    {team}
                  </button>
                ))}
              </div>
              <select
                aria-label="담당자 필터"
                className="owner-filter-select"
                onChange={(event) => {
                  setOwnerFilter(event.target.value);
                  collapseExpandedItems();
                }}
                value={effectiveOwnerFilter}
              >
                {ownerOptions.map((owner) => (
                  <option key={owner}>{owner}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="calendar-grid" aria-label={`${monthLabel} 운영 달력`}>
            {["월", "화", "수", "목", "금", "토", "일"].map((day) => (
              <div className="calendar-weekday" key={day}>{day}</div>
            ))}
            {calendarWeeks.map((week) => {
              const isExpanded = expandedCalendarDays.has(week.key);
              const visibleSegments = getVisibleCalendarSegments(week.segments, isExpanded);
              const hiddenCount = week.segments.length - visibleSegments.length;
              const hasHiddenLanes = hasHiddenCalendarLanes(week.segments);
              const visibleLaneCount = getVisibleCalendarLaneCount(visibleSegments);
              const weekStyle = {
                "--calendar-event-rows": visibleLaneCount + (hasHiddenLanes ? 1 : 0)
              } as CSSProperties;

              return (
                <div className="calendar-week-row" key={week.key} style={weekStyle}>
                  {week.days.map((day) => (
                    <div className={`calendar-day ${day.inMonth ? "" : "muted-day"}`} key={day.date.toISOString()}>
                      <span className="calendar-date">
                        {day.date.getDate()}
                        {isToday(day.date) ? <strong>오늘</strong> : null}
                      </span>
                    </div>
                  ))}
                  <div className="calendar-week-events">
                    {visibleSegments.map((segment) => (
                      <Link
                        className={`calendar-event ${calendarSegmentPositionClass(segment)}`}
                        href={`/operations/${segment.operation.operationId}`}
                        key={segment.key}
                        style={{ gridColumn: `${segment.startColumn} / span ${segment.span}`, gridRow: segment.lane + 1 }}
                      >
                        <strong>{segment.operation.courseName}</strong>
                        <span>
                          <Tag tone={ownerTone(segment.operation.om || "배정필요")}>{segment.operation.om || "배정필요"}</Tag>
                        </span>
                      </Link>
                    ))}
                    {hiddenCount > 0 ? (
                      <button
                        className="event-overflow calendar-week-overflow"
                        onClick={() => toggleExpandedCalendarDay(week.key)}
                        style={{ gridColumn: "1 / -1", gridRow: visibleLaneCount + 1 }}
                        type="button"
                      >
                        +{hiddenCount}건 더 보기
                      </button>
                    ) : null}
                    {isExpanded && hasHiddenLanes ? (
                      <button
                        className="event-overflow calendar-week-overflow"
                        onClick={() => toggleExpandedCalendarDay(week.key)}
                        style={{ gridColumn: "1 / -1", gridRow: visibleLaneCount + 1 }}
                        type="button"
                      >
                        접기
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="resource-section compact-resource-section">
          <div className="section-title resource-section-title">
            <h2>운영 현황 보드</h2>
          </div>
          <div className="resource-owner-board">
            {omGroups.length > 0 ? (
              omGroups.map((group) => (
                <section className="resource-owner-panel" key={group.owner}>
                  <div className="resource-owner-header">
                    <h3>{group.owner}</h3>
                    <span>{group.operations.length}건</span>
                  </div>
                  {BOARD_GROUPS.map((boardGroup) => {
                    const groupOperations = group.operations.filter((operation) =>
                      boardGroup.statuses.includes(operation.operationStatus)
                    );

                    return (
                      <section className="resource-owner-status" key={`${group.owner}-${boardGroup.label}`}>
                        <div className="resource-status-heading">
                          <span className="group-label">
                            <span className={`status-dot ${statusGroupTone(boardGroup.label)}`} aria-hidden="true" />
                            {boardGroup.label}
                          </span>
                          <strong>{groupOperations.length}건</strong>
                        </div>
                        <div className="resource-card-list">
                          {getVisibleBoardOperations(groupOperations, expandedBoardLanes.has(boardLaneKey(group.owner, boardGroup.label))).map((operation) => (
                            <Link className="resource-card" href={`/operations/${operation.operationId}`} key={operation.operationId}>
                              <span className="resource-card-tags">
                                <Tag tone={STATUS_TONE[operation.operationStatus]}>{operation.operationStatus}</Tag>
                              </span>
                              <strong>{operation.courseName}</strong>
                              <span className="resource-card-tags">
                                <Tag tone="gray">{formatDateRange(operation)}</Tag>
                                <Tag tone={ownerTone(operation.om || "배정필요")}>{operation.om || "배정필요"}</Tag>
                              </span>
                              <span className="resource-meta">
                                {resourceLoadLabel(operation)} · {nearbyLabel(operation, filteredOperations, group.owner)}
                              </span>
                            </Link>
                          ))}
                          {groupOperations.length > MAX_BOARD_CARDS_PER_LANE && !expandedBoardLanes.has(boardLaneKey(group.owner, boardGroup.label)) ? (
                            <button className="resource-empty-card resource-more-button" onClick={() => toggleExpandedBoardLane(boardLaneKey(group.owner, boardGroup.label))} type="button">
                              +{groupOperations.length - MAX_BOARD_CARDS_PER_LANE}건 더 보기
                            </button>
                          ) : null}
                          {groupOperations.length > MAX_BOARD_CARDS_PER_LANE && expandedBoardLanes.has(boardLaneKey(group.owner, boardGroup.label)) ? (
                            <button className="resource-empty-card resource-more-button" onClick={() => toggleExpandedBoardLane(boardLaneKey(group.owner, boardGroup.label))} type="button">
                              접기
                            </button>
                          ) : null}
                          {groupOperations.length === 0 ? <span className="resource-empty-card">비어 있음</span> : null}
                        </div>
                      </section>
                    );
                  })}
                </section>
              ))
            ) : (
              <div className="resource-empty-board">
                <strong>표시할 리소스가 없습니다.</strong>
                <span>팀 또는 월을 바꿔 확인하세요.</span>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );

  function collapseExpandedItems() {
    setExpandedCalendarDays(new Set());
    setExpandedBoardLanes(new Set());
  }

  function toggleExpandedCalendarDay(dayKey: string) {
    setExpandedCalendarDays((current) => toggleSetValue(current, dayKey));
  }

  function toggleExpandedBoardLane(laneKey: string) {
    setExpandedBoardLanes((current) => toggleSetValue(current, laneKey));
  }

  function updateViewDate(date: Date) {
    setViewDate(date);
    collapseExpandedItems();
  }
}

function Tag({ children, tone }: { children: string; tone: string }) {
  return <span className={`resource-tag ${tone}`}>{children}</span>;
}

function buildCalendarWeeks(anchorDate: Date, operations: OperationSession[]): CalendarWeek[] {
  const days = buildCalendarDays(anchorDate);

  return Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => {
    const weekDays = days.slice(index * 7, index * 7 + 7);

    return {
      days: weekDays,
      key: dateKey(weekDays[0].date),
      segments: buildCalendarWeekSegments(weekDays, operations)
    };
  });
}

function buildCalendarDays(anchorDate: Date): CalendarDay[] {
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
      inMonth: date.getMonth() === month
    };
  });
}

function buildCalendarWeekSegments(days: CalendarDay[], operations: OperationSession[]) {
  const weekStart = days[0].date;
  const weekEnd = days[days.length - 1].date;
  const candidates = operations
    .map((operation) => {
      const start = parseDate(operation.startDate);
      const end = parseDate(operation.endDate);

      if (!start || !end || start.getTime() > weekEnd.getTime() || end.getTime() < weekStart.getTime()) {
        return null;
      }

      const totalDuration = durationDays(start, end);
      const shouldRenderContinuously = totalDuration <= MAX_CALENDAR_CONTINUOUS_DAYS;
      const startInWeek = isWithinDateRange(start, weekStart, weekEnd);
      const endInWeek = isWithinDateRange(end, weekStart, weekEnd);

      if (!shouldRenderContinuously && !startInWeek && !endInWeek) {
        return null;
      }

      const segmentStart = shouldRenderContinuously ? maxDate(start, weekStart) : startInWeek ? start : end;
      const segmentEnd = shouldRenderContinuously ? minDate(end, weekEnd) : segmentStart;

      return {
        end,
        longSummary: !shouldRenderContinuously,
        operation,
        segmentEnd,
        segmentStart,
        start
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => {
      const startDiff = a.segmentStart.getTime() - b.segmentStart.getTime();
      if (startDiff !== 0) return startDiff;
      const durationDiff = durationDays(b.segmentStart, b.segmentEnd) - durationDays(a.segmentStart, a.segmentEnd);
      if (durationDiff !== 0) return durationDiff;
      return compareStableText(a.operation.courseName, b.operation.courseName);
    });
  const laneEnds: number[] = [];

  return candidates.map((candidate) => {
    const startColumn = dateDiffDays(weekStart, candidate.segmentStart) + 1;
    const span = dateDiffDays(candidate.segmentStart, candidate.segmentEnd) + 1;
    const lane = findCalendarLane(laneEnds, startColumn);

    laneEnds[lane] = startColumn + span - 1;

    return {
      endsAfterWeek: candidate.end.getTime() > weekEnd.getTime(),
      key: `${candidate.operation.operationId}-${dateKey(weekStart)}`,
      lane,
      longSummary: candidate.longSummary,
      operation: candidate.operation,
      span,
      startColumn,
      startsBeforeWeek: candidate.start.getTime() < weekStart.getTime()
    };
  });
}

function findCalendarLane(laneEnds: number[], startColumn: number) {
  const reusableLane = laneEnds.findIndex((endColumn) => endColumn < startColumn);
  return reusableLane >= 0 ? reusableLane : laneEnds.length;
}

function parseDate(value: string) {
  if (!value) return null;

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shiftMonth(value: Date, offset: number) {
  return new Date(value.getFullYear(), value.getMonth() + offset, 1);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function isToday(date: Date) {
  const today = new Date();

  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function groupByOwner(operations: OperationSession[], owners: string[], allowedOwners: Set<string>) {
  const sorted = [...operations].sort((a, b) => compareStableText(a.startDate, b.startDate));
  const groups = new Map<string, OperationSession[]>();

  for (const owner of owners) {
    groups.set(owner, []);
  }

  for (const operation of sorted) {
    for (const owner of getResourceOwners(operation.om, allowedOwners)) {
      groups.set(owner, [...(groups.get(owner) ?? []), operation]);
    }
  }

  return Array.from(groups.entries()).map(([owner, ownerOperations]) => ({
    owner,
    operations: ownerOperations
  }));
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort(compareStableText);
}

function getRosterOwners(ownerRoster: ResourceOwnerRoster, teamFilter: (typeof TEAM_FILTERS)[number]) {
  if (teamFilter === "전체") {
    return unique(Object.values(ownerRoster).flatMap((owners) => owners ?? []));
  }

  return ownerRoster[teamFilter] ?? [];
}

function getSourceTeam(operation: OperationSession): SourceTeam {
  return operation.sourceTeam ?? "미분류";
}

function isInCalendarWindow(operation: OperationSession, viewDate: Date) {
  const start = parseDate(operation.startDate);
  const end = parseDate(operation.endDate);
  if (!start || !end) return false;

  const windowStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const windowEnd = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);

  return start.getTime() <= windowEnd.getTime() && windowStart.getTime() <= end.getTime();
}

function isInBoardWindow(operation: OperationSession, viewDate: Date) {
  if (operation.operationStatus === "완료" || operation.operationStatus === "회고완료") return false;

  const start = parseDate(operation.startDate);
  const end = parseDate(operation.endDate);
  if (!start || !end) return false;

  const windowStart = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
  const windowEnd = new Date(viewDate.getFullYear(), viewDate.getMonth() + 3, 0);

  return start.getTime() <= windowEnd.getTime() && windowStart.getTime() <= end.getTime();
}

function durationDays(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function dateDiffDays(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function minDate(left: Date, right: Date) {
  return left.getTime() <= right.getTime() ? left : right;
}

function maxDate(left: Date, right: Date) {
  return left.getTime() >= right.getTime() ? left : right;
}

function isWithinDateRange(date: Date, start: Date, end: Date) {
  return start.getTime() <= date.getTime() && date.getTime() <= end.getTime();
}

function calendarSegmentPositionClass(segment: CalendarEventSegment) {
  if (segment.longSummary) return "long-event-summary";
  if (segment.span === 1 && !segment.startsBeforeWeek && !segment.endsAfterWeek) return "single-day-event";
  if (!segment.startsBeforeWeek && !segment.endsAfterWeek) return "multi-day-complete";
  if (!segment.startsBeforeWeek) return "multi-day-start";
  if (!segment.endsAfterWeek) return "multi-day-end";
  return "multi-day-middle";
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

function ownerTone(owner: string) {
  const index = Math.abs(
    owner.split("").reduce((total, character) => total + character.charCodeAt(0), 0)
  );

  return OWNER_TONES[index % OWNER_TONES.length];
}

function statusGroupTone(label: string) {
  if (label === "시작 전") return "amber";
  if (label === "진행 중") return "blue";
  return "gray";
}

function boardLaneKey(owner: string, label: string) {
  return `${owner}:${label}`;
}

function getVisibleBoardOperations(operations: OperationSession[], isExpanded: boolean) {
  return isExpanded ? operations : operations.slice(0, MAX_BOARD_CARDS_PER_LANE);
}

function getVisibleCalendarSegments(segments: CalendarEventSegment[], isExpanded: boolean) {
  return isExpanded ? segments : segments.filter((segment) => segment.lane < MAX_CALENDAR_EVENT_LANES);
}

function hasHiddenCalendarLanes(segments: CalendarEventSegment[]) {
  return segments.some((segment) => segment.lane >= MAX_CALENDAR_EVENT_LANES);
}

function getVisibleCalendarLaneCount(segments: CalendarEventSegment[]) {
  if (segments.length === 0) return 0;
  return Math.max(...segments.map((segment) => segment.lane + 1));
}

function toggleSetValue(current: Set<string>, value: string) {
  const next = new Set(current);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

function formatDateRange(operation: OperationSession) {
  const start = formatShortDate(operation.startDate);
  const end = formatShortDate(operation.endDate);

  return start === end ? start : `${start}~${end}`;
}

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");

  return `${Number(month)}/${Number(day)}`;
}

function nearbyLabel(operation: OperationSession, operations: OperationSession[], owner: string) {
  const start = parseDate(operation.startDate);
  if (!start) return "주변 일정 확인 필요";

  const count = operations.filter((candidate) => {
    if (candidate.operationId === operation.operationId || !splitPersonNames(candidate.om).includes(owner)) return false;
    const candidateStart = parseDate(candidate.startDate);
    if (!candidateStart) return false;
    const diff = Math.abs(candidateStart.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    return diff <= 7;
  }).length;

  return count > 0 ? `근처 일정 ${count}건` : "근처 일정 없음";
}

function getResourceOwners(value: string, allowedOwners: Set<string>) {
  const owners = splitPersonNames(value).filter((owner) => allowedOwners.has(owner));
  if (owners.length === 0 && allowedOwners.has("배정필요")) return ["배정필요"];

  return owners.length > 0 ? owners : [];
}

function getAssignmentNeededOption(operations: OperationSession[], rosterOwners: string[]) {
  const rosterOwnerSet = new Set(rosterOwners);
  const hasUnassigned = operations.some((operation) => splitPersonNames(operation.om).every((owner) => !rosterOwnerSet.has(owner)));

  return hasUnassigned ? ["배정필요"] : [];
}
