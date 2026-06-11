"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { OperationSession, OperationStatus } from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";
import type { ResourceOwnerRoster } from "@/lib/data/teamMemberRepository";
import { teamScopeSearchParam, type TeamScope } from "@/lib/teamScope";

const BOARD_GROUPS: Array<{ label: string; statuses: OperationStatus[] }> = [
  { label: "시작 전", statuses: ["배정필요", "배정예정"] },
  { label: "진행 중", statuses: ["진행중"] },
  { label: "완료", statuses: ["완료", "회고완료", "아카이빙필요"] }
];

const UNASSIGNED_OWNER = "배정필요";
const UNMATCHED_OWNER = "매칭 필요";
const OWNER_ALIASES: Record<string, string> = {
  "이유진": "이유진C"
};
const OWNER_TONES = ["green", "amber", "pink", "purple", "blue", "gray"] as const;
const MAX_CALENDAR_CONTINUOUS_DAYS = 31;
const MAX_CALENDAR_EVENT_LANES = 3;
const MAX_BOARD_CARDS_PER_LANE = 4;

interface ResourceJudgmentPageProps {
  operations: OperationSession[];
  ownerRoster?: ResourceOwnerRoster;
  teamScope: TeamScope;
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

interface ResourceBoardItem {
  endDate: string;
  key: string;
  operations: OperationSession[];
  representative: OperationSession;
  startDate: string;
  totalOperations: OperationSession[];
}

export function ResourceJudgmentPage({ operations, ownerRoster = {}, teamScope }: ResourceJudgmentPageProps) {
  const [viewDate, setViewDate] = useState(new Date());
  const teamQuery = teamScopeSearchParam(teamScope);
  const [ownerFilter, setOwnerFilter] = useState("전체 담당자");
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [expandedCalendarDays, setExpandedCalendarDays] = useState<Set<string>>(() => new Set());
  const [expandedBoardLanes, setExpandedBoardLanes] = useState<Set<string>>(() => new Set());
  const teamOperations = operations;
  const rosterOwners = useMemo(() => getRosterOwners(ownerRoster), [ownerRoster]);
  const ownerOptions = useMemo(
    () => ["전체 담당자", ...unique([...rosterOwners, ...getAssignmentNeededOption(teamOperations, rosterOwners)])],
    [rosterOwners, teamOperations]
  );
  const boardOwnerOptions = useMemo(() => ownerOptions.filter((owner) => owner !== UNMATCHED_OWNER), [ownerOptions]);
  const resourceOwnerMap = useMemo(() => buildOwnerDisplayMap([...boardOwnerOptions.slice(1), UNMATCHED_OWNER]), [boardOwnerOptions]);
  const effectiveOwnerFilter = ownerOptions.includes(ownerFilter) ? ownerFilter : "전체 담당자";
  const filteredOperations = useMemo(
    () =>
      teamOperations.filter(
        (operation) =>
          effectiveOwnerFilter === "전체 담당자" ||
          getResourceOwners(operation.om, resourceOwnerMap).includes(effectiveOwnerFilter)
      ),
    [effectiveOwnerFilter, resourceOwnerMap, teamOperations]
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
  const boardOwners = effectiveOwnerFilter === "전체 담당자" ? boardOwnerOptions.slice(1) : [effectiveOwnerFilter];
  const omGroups = groupByOwner(boardOperations, boardOwners, resourceOwnerMap);
  const allOmGroups = groupByOwner(filteredOperations, boardOwners, resourceOwnerMap);
  const allOperationsByOwner = new Map(allOmGroups.map((group) => [group.owner, group.operations]));
  const unmatchedBoardGroup = groupByOwner(boardOperations, [UNMATCHED_OWNER], resourceOwnerMap)[0] ?? {
    operations: [],
    owner: UNMATCHED_OWNER
  };
  const allUnmatchedOperations = groupByOwner(filteredOperations, [UNMATCHED_OWNER], resourceOwnerMap)[0]?.operations ?? [];

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Resource view" teamScope={teamScope} />

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
                        href={`/operations/${segment.operation.operationId}${teamQuery}`}
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
            {unmatchedBoardGroup.operations.length > 0 ? (
              <label className="inline-toggle">
                <input
                  checked={showUnmatched}
                  onChange={(event) => setShowUnmatched(event.target.checked)}
                  type="checkbox"
                />
                <span>매칭 필요 보기</span>
              </label>
            ) : null}
          </div>
          <div className="resource-owner-board">
            {omGroups.length > 0 ? (
              omGroups.map((group) => (
                <OwnerBoard
                  group={group}
                  isExpanded={(label) => expandedBoardLanes.has(boardLaneKey(group.owner, label))}
                  key={group.owner}
                  totalOperations={allOperationsByOwner.get(group.owner) ?? group.operations}
                  teamQuery={teamQuery}
                  toggleExpandedBoardLane={toggleExpandedBoardLane}
                />
              ))
            ) : (
              <div className="resource-empty-board">
                <strong>표시할 리소스가 없습니다.</strong>
                <span>팀 또는 월을 바꿔 확인하세요.</span>
              </div>
            )}
          </div>
          {showUnmatched && unmatchedBoardGroup.operations.length > 0 ? (
            <div className="resource-unmatched-section">
              <div className="section-title resource-section-title">
                <h3>매칭 필요</h3>
                <span>{unmatchedBoardGroup.operations.length}건</span>
              </div>
              <div className="resource-owner-board unmatched-board">
                <OwnerBoard
                  group={unmatchedBoardGroup}
                  isExpanded={(label) => expandedBoardLanes.has(boardLaneKey(UNMATCHED_OWNER, label))}
                  totalOperations={allUnmatchedOperations}
                  teamQuery={teamQuery}
                  toggleExpandedBoardLane={toggleExpandedBoardLane}
                />
              </div>
            </div>
          ) : null}
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

function OwnerBoard({
  group,
  isExpanded,
  totalOperations,
  teamQuery,
  toggleExpandedBoardLane
}: {
  group: { operations: OperationSession[]; owner: string };
  isExpanded: (label: string) => boolean;
  totalOperations: OperationSession[];
  teamQuery: string;
  toggleExpandedBoardLane: (laneKey: string) => void;
}) {
  const boardItems = buildBoardItems(group.operations, group.owner, totalOperations);

  return (
    <section className="resource-owner-panel">
      <div className="resource-owner-header">
        <h3>{group.owner}</h3>
        <span>{boardItems.length}건</span>
      </div>
      {BOARD_GROUPS.map((boardGroup) => {
        const groupItems = boardItems.filter((item) =>
          boardGroup.statuses.includes(item.representative.operationStatus)
        );
        const laneKey = boardLaneKey(group.owner, boardGroup.label);
        const expanded = isExpanded(boardGroup.label);

        return (
          <section className="resource-owner-status" key={`${group.owner}-${boardGroup.label}`}>
            <div className="resource-status-heading">
              <span className="group-label">
                <span className={`status-dot ${statusGroupTone(boardGroup.label)}`} aria-hidden="true" />
                {boardGroup.label}
              </span>
              <strong>{groupItems.length}건</strong>
            </div>
            <div className="resource-card-list">
              {getVisibleBoardItems(groupItems, expanded).map((item) => (
                <Link
                  className="resource-card"
                  href={`/operations/${item.representative.operationId}${teamQuery}`}
                  key={item.key}
                >
                  <strong>{item.representative.courseName}</strong>
                  <span className="resource-card-tags">
                    <Tag tone="gray">{formatBoardItemDateRange(item)}</Tag>
                    {shouldShowStatusCount(item) ? <Tag tone="blue">{statusCountLabel(item, boardGroup.label)}</Tag> : null}
                    {courseRoundLabel(item) ? <Tag tone="gray">{courseRoundLabel(item)}</Tag> : null}
                    {group.owner === UNMATCHED_OWNER ? <Tag tone="pink">{item.representative.om}</Tag> : null}
                  </span>
                </Link>
              ))}
              {groupItems.length > MAX_BOARD_CARDS_PER_LANE && !expanded ? (
                <button className="resource-empty-card resource-more-button" onClick={() => toggleExpandedBoardLane(laneKey)} type="button">
                  +{groupItems.length - MAX_BOARD_CARDS_PER_LANE}건 더 보기
                </button>
              ) : null}
              {groupItems.length > MAX_BOARD_CARDS_PER_LANE && expanded ? (
                <button className="resource-empty-card resource-more-button" onClick={() => toggleExpandedBoardLane(laneKey)} type="button">
                  접기
                </button>
              ) : null}
              {groupItems.length === 0 ? <span className="resource-empty-card">비어 있음</span> : null}
            </div>
          </section>
        );
      })}
    </section>
  );
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

function groupByOwner(operations: OperationSession[], owners: string[], allowedOwners: Map<string, string>) {
  const sorted = [...operations].sort((a, b) => compareStableText(a.startDate, b.startDate));
  const groups = new Map<string, OperationSession[]>();

  for (const owner of owners) {
    groups.set(owner, []);
  }

  for (const operation of sorted) {
    for (const owner of getResourceOwners(operation.om, allowedOwners)) {
      if (!groups.has(owner)) continue;

      groups.set(owner, [...(groups.get(owner) ?? []), operation]);
    }
  }

  return Array.from(groups.entries()).map(([owner, ownerOperations]) => ({
    owner,
    operations: ownerOperations
  }));
}

function buildBoardItems(operations: OperationSession[], owner: string, totalOperations: OperationSession[]): ResourceBoardItem[] {
  const grouped = new Map<string, OperationSession[]>();
  const totalGrouped = new Map<string, OperationSession[]>();

  for (const operation of totalOperations) {
    const key = boardTotalKey(operation, owner);
    totalGrouped.set(key, [...(totalGrouped.get(key) ?? []), operation]);
  }

  for (const operation of operations) {
    const key = boardMergeKey(operation, owner);
    grouped.set(key, [...(grouped.get(key) ?? []), operation]);
  }

  return Array.from(grouped.entries())
    .map(([key, groupedOperations]) => buildBoardItem(key, groupedOperations, totalGrouped.get(boardTotalKey(groupedOperations[0], owner)) ?? groupedOperations))
    .sort((a, b) => compareStableText(a.startDate, b.startDate));
}

function buildBoardItem(key: string, operations: OperationSession[], totalOperations: OperationSession[]): ResourceBoardItem {
  const sorted = [...operations].sort((a, b) => {
    const startDiff = compareStableText(a.startDate, b.startDate);
    if (startDiff !== 0) return startDiff;
    return compareStableText(a.operationId, b.operationId);
  });

  return {
    endDate: sorted.reduce((latest, operation) => maxDateString(latest, operation.endDate), sorted[0].endDate),
    key,
    operations: sorted,
    representative: sorted[0],
    startDate: sorted[0].startDate,
    totalOperations
  };
}

function boardMergeKey(operation: OperationSession, owner: string) {
  return [
    owner,
    owner === UNMATCHED_OWNER ? operation.om : "",
    operation.courseId,
    operation.companyName,
    operation.courseName,
    operation.operationStatus,
    operation.operationType,
    operation.archiveStatus
  ].map(normalizeBoardKeyPart).join("|");
}

function boardTotalKey(operation: OperationSession, owner: string) {
  return [
    owner,
    owner === UNMATCHED_OWNER ? operation.om : "",
    operation.courseId,
    operation.companyName,
    operation.courseName,
    operation.operationType
  ].map(normalizeBoardKeyPart).join("|");
}

function normalizeBoardKeyPart(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function maxDateString(left: string, right: string) {
  return left >= right ? left : right;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort(compareStableText);
}

function buildOwnerDisplayMap(owners: string[]) {
  return new Map(owners.map((owner) => [normalizeOwnerName(owner), owner]));
}

function getRosterOwners(ownerRoster: ResourceOwnerRoster) {
  return unique(Object.values(ownerRoster).flatMap((owners) => owners ?? []));
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

function getVisibleBoardItems(items: ResourceBoardItem[], isExpanded: boolean) {
  return isExpanded ? items : items.slice(0, MAX_BOARD_CARDS_PER_LANE);
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

function formatBoardItemDateRange(item: ResourceBoardItem) {
  const start = formatShortDate(item.startDate);
  const end = formatShortDate(item.endDate);

  return start === end ? start : `${start}~${end}`;
}

function courseRoundLabel(item: ResourceBoardItem) {
  const totalRoundCount = getRoundCount(item.totalOperations);
  if (totalRoundCount > 1) return `총 ${totalRoundCount}회차`;

  const rounds = unique(item.operations.map((operation) => operation.roundNo).filter(Boolean));

  return formatRoundLabel(rounds);
}

function getRoundCount(operations: OperationSession[]) {
  const rounds = unique(operations.map((operation) => operation.roundNo).filter(Boolean));

  return rounds.length > 0 ? rounds.length : operations.length;
}

function formatRoundLabel(rounds: string[]) {
  if (rounds.length === 0) return "";
  if (rounds.length === 1) return `${rounds[0]}회차`;

  const numericRounds = rounds.map(Number);
  const canUseRange =
    numericRounds.every(Number.isInteger) &&
    Math.max(...numericRounds) - Math.min(...numericRounds) + 1 === numericRounds.length;

  if (canUseRange) return `${Math.min(...numericRounds)}~${Math.max(...numericRounds)}회차`;

  return `${rounds.join(", ")}회차`;
}

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");

  return `${Number(month)}/${Number(day)}`;
}

function getResourceOwners(value: string, allowedOwners: Map<string, string>) {
  const owners = splitPersonNames(value)
    .map((owner) => resolveOwnerDisplayName(owner, allowedOwners))
    .filter((owner): owner is string => Boolean(owner));

  return unique(owners);
}

function getAssignmentNeededOption(operations: OperationSession[], rosterOwners: string[]) {
  const rosterOwnerMap = buildOwnerDisplayMap(rosterOwners);
  const hasUnassigned = operations.some((operation) => splitPersonNames(operation.om).some(isUnassignedOwner));
  const hasUnmatched = operations.some((operation) =>
    splitPersonNames(operation.om).some(
      (owner) => !isUnassignedOwner(owner) && !resolveOwnerDisplayName(owner, rosterOwnerMap, false)
    )
  );
  const options: string[] = [];

  if (hasUnassigned) options.push(UNASSIGNED_OWNER);
  if (hasUnmatched) options.push(UNMATCHED_OWNER);

  return options;
}

function resolveOwnerDisplayName(owner: string, allowedOwners: Map<string, string>, includeFallback = true) {
  const directOwner = allowedOwners.get(normalizeOwnerName(owner));
  if (directOwner) return directOwner;

  const aliasOwner = OWNER_ALIASES[normalizeOwnerName(owner)];
  if (aliasOwner) return allowedOwners.get(normalizeOwnerName(aliasOwner)) ?? null;

  if (!includeFallback) return null;
  if (isUnassignedOwner(owner) && allowedOwners.has(normalizeOwnerName(UNASSIGNED_OWNER))) return UNASSIGNED_OWNER;
  if (allowedOwners.has(normalizeOwnerName(UNMATCHED_OWNER))) return UNMATCHED_OWNER;

  return null;
}

function normalizeOwnerName(value: string) {
  return value
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isUnassignedOwner(value: string) {
  const normalized = value.replace(/\s+/g, "");
  return normalized.includes("배정필요") || normalized.includes("배정예정");
}

function statusCountLabel(item: ResourceBoardItem, statusLabel: string) {
  return `${item.operations.length}회 ${statusLabel}`;
}

function shouldShowStatusCount(item: ResourceBoardItem) {
  return item.operations.length > 1 || getRoundCount(item.totalOperations) > 1;
}
