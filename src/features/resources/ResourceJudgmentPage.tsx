"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { holidayName } from "@/features/dashboard/holidays";
import type { OmAvailabilityRoster } from "@/lib/data/omAvailability/omAvailabilityTypes";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";
import type { OperationSession } from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";
import type { ResourceOwnerRoster } from "@/lib/data/teamMemberRepository";
import type { CalendarResourceEvent } from "@/lib/sourceReads";
import { teamScopeSearchParam, type TeamScope } from "@/lib/teamScope";

const UNMATCHED_OWNER = "매칭 필요";
const PART_ORDER = ["1파트", "2파트", "3파트"];
const UNCLASSIFIED_PART = "미분류";
const ALL_PARTS_FILTER = "전체담당자";
const OWNER_ALIASES: Record<string, string> = {
  "이유진": "이유진C"
};
const OWNER_TONES = ["green", "amber", "pink", "purple", "blue", "gray"] as const;
const MAX_CALENDAR_CONTINUOUS_DAYS = 31;
const MAX_CALENDAR_EVENT_LANES = 3;
const CALENDAR_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface ResourceJudgmentPageProps {
  calendarEvents?: CalendarResourceEvent[];
  operations: OperationSession[];
  ownerRoster?: ResourceOwnerRoster;
  partRoster?: OmAvailabilityRoster;
  pendingOmRequests?: OmRequest[];
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
  item: CalendarItem;
  key: string;
  lane: number;
  longSummary: boolean;
  span: number;
  startColumn: number;
  startsBeforeWeek: boolean;
}

interface CalendarItem {
  endDate: Date;
  eventKind?: CalendarResourceEvent["eventKind"];
  href?: string;
  key: string;
  onsiteOwnerName?: string;
  ownerName: string;
  startDate: Date;
  title: string;
  type: "operation" | "request" | "source";
}

export function ResourceJudgmentPage({
  calendarEvents = [],
  operations,
  ownerRoster = {},
  partRoster = {},
  pendingOmRequests = [],
  teamScope
}: ResourceJudgmentPageProps) {
  const [viewDate, setViewDate] = useState(new Date());
  const teamQuery = teamScopeSearchParam(teamScope);
  const [ownerFilter, setOwnerFilter] = useState("전체 담당자");
  const [partFilter, setPartFilter] = useState(ALL_PARTS_FILTER);
  const [expandedCalendarDays, setExpandedCalendarDays] = useState<Set<string>>(() => new Set());
  const teamOperations = operations;
  const rosterOwners = useMemo(() => getRosterOwners(ownerRoster), [ownerRoster]);
  const ownerPartMap = useMemo(() => buildOwnerPartMap(partRoster), [partRoster]);
  const allOwnerOptions = useMemo(
    () => ["전체 담당자", ...rosterOwners],
    [rosterOwners]
  );
  const boardOwnerOptions = useMemo(() => allOwnerOptions.filter((owner) => owner !== UNMATCHED_OWNER), [allOwnerOptions]);
  const resourceOwnerMap = useMemo(() => buildOwnerDisplayMap([...boardOwnerOptions.slice(1), UNMATCHED_OWNER]), [boardOwnerOptions]);
  const partScopedOwners = useMemo(
    () =>
      partFilter === ALL_PARTS_FILTER
        ? boardOwnerOptions.slice(1)
        : boardOwnerOptions.slice(1).filter((owner) => getOwnerPart(owner, ownerPartMap) === partFilter),
    [boardOwnerOptions, ownerPartMap, partFilter]
  );
  const ownerOptions = useMemo(() => ["전체 담당자", ...partScopedOwners], [partScopedOwners]);
  const effectiveOwnerFilter = ownerOptions.includes(ownerFilter) ? ownerFilter : "전체 담당자";
  const filteredOperations = useMemo(
    () =>
      teamOperations.filter((operation) =>
        ownerNamesInScope(getOperationResourceOwners(operation, resourceOwnerMap), effectiveOwnerFilter, partFilter, ownerPartMap)
      ),
    [effectiveOwnerFilter, ownerPartMap, partFilter, resourceOwnerMap, teamOperations]
  );
  const calendarOperations = useMemo(
    () => filteredOperations.filter((operation) => isInCalendarWindow(operation, viewDate)),
    [filteredOperations, viewDate]
  );
  const filteredCalendarEvents = useMemo(
    () =>
      calendarEvents.filter((event) => {
        if (!isCalendarEventInWindow(event, viewDate)) return false;

        const ownerName = resolveOwnerDisplayName(event.ownerName, resourceOwnerMap) ?? "";
        return ownerNamesInScope([ownerName], effectiveOwnerFilter, partFilter, ownerPartMap);
      }),
    [calendarEvents, effectiveOwnerFilter, ownerPartMap, partFilter, resourceOwnerMap, viewDate]
  );
  const filteredPendingRequests = useMemo(
    () =>
      pendingOmRequests.filter((request) =>
        ownerNamesInScope(
          [getCalendarOperationOwner(request.assignedOm ?? "", resourceOwnerMap)],
          effectiveOwnerFilter,
          partFilter,
          ownerPartMap
        )
      ),
    [effectiveOwnerFilter, ownerPartMap, partFilter, pendingOmRequests, resourceOwnerMap]
  );
  const calendarPendingRequestItems = useMemo(
    () =>
      filteredPendingRequests
        .flatMap((request) => omRequestToCalendarItems(request, teamQuery, resourceOwnerMap))
        .filter((item) => isCalendarItemInWindow(item, viewDate)),
    [filteredPendingRequests, resourceOwnerMap, teamQuery, viewDate]
  );
  const calendarWeeks = buildCalendarWeeks(
    viewDate,
    calendarOperations,
    filteredCalendarEvents,
    calendarPendingRequestItems,
    teamQuery,
    resourceOwnerMap
  );
  const monthLabel = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    year: "numeric"
  }).format(viewDate);
  return (
    <main className="dashboard-shell">
      <AppSidebar label="Resource view" teamScope={teamScope} />

      <section className="content resource-content">
        <header className="resource-page-header">
          <div>
            <h1>리소스</h1>
            <p className="lede">
              달력과 OM별 운영 목록을 함께 보며 실제로 추가 요청을 받을 수 있는지 확인합니다.
            </p>
          </div>
        </header>

        <div className="resource-part-filters">
          {[ALL_PARTS_FILTER, ...PART_ORDER].map((part) => (
            <button
              className={`om-filter-btn${partFilter === part ? " selected" : ""}`}
              key={part}
              onClick={() => {
                setPartFilter(part);
                setOwnerFilter("전체 담당자");
                collapseExpandedItems();
              }}
              type="button"
            >
              {part}
            </button>
          ))}
        </div>

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
            {CALENDAR_WEEKDAYS.map((day, index) => (
              <div
                className={["calendar-weekday", index === 0 ? "is-sun" : "", index === 6 ? "is-sat" : ""].filter(Boolean).join(" ")}
                key={day}
              >
                {day}
              </div>
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
                  {week.days.map((day) => {
                    const dow = day.date.getDay();
                    const holiday = day.inMonth ? holidayName(day.date) : null;
                    const isSun = dow === 0 || Boolean(holiday);
                    const isSat = dow === 6 && !isSun;
                    return (
                      <div className={`calendar-day ${day.inMonth ? "" : "muted-day"}`} key={day.date.toISOString()}>
                        <span className="calendar-date">
                          <span className="calendar-date-main">
                            <span className={["calendar-date-num", isSun ? "is-sun" : "", isSat ? "is-sat" : ""].filter(Boolean).join(" ")}>
                              {day.date.getDate()}
                            </span>
                            {holiday ? <span className="calendar-holiday-name" title={holiday}>{holiday}</span> : null}
                          </span>
                          {isToday(day.date) ? <strong>오늘</strong> : null}
                        </span>
                      </div>
                    );
                  })}
                  <div className="calendar-week-events">
                    {visibleSegments.map((segment) => (
                      <CalendarEventCard key={segment.key} segment={segment} />
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
      </section>
    </main>
  );

  function collapseExpandedItems() {
    setExpandedCalendarDays(new Set());
  }

  function toggleExpandedCalendarDay(dayKey: string) {
    setExpandedCalendarDays((current) => toggleSetValue(current, dayKey));
  }

  function updateViewDate(date: Date) {
    setViewDate(date);
    collapseExpandedItems();
  }
}

function Tag({ children, tone }: { children: string; tone: string }) {
  return <span className={`resource-tag ${tone}`}>{children}</span>;
}

function CalendarEventCard({ segment }: { segment: CalendarEventSegment }) {
  const className = [
    "calendar-event",
    calendarSegmentPositionClass(segment),
    segment.item.type === "source" ? "source-calendar-event" : "",
    segment.item.type === "request" ? "request-calendar-event" : "",
    segment.item.eventKind === "absence" ? "absence-calendar-event" : ""
  ].filter(Boolean).join(" ");
  const style = { gridColumn: `${segment.startColumn} / span ${segment.span}`, gridRow: segment.lane + 1 };
  const content = (
    <>
      <span>
        {segment.item.ownerName ? <Tag tone={ownerTone(segment.item.ownerName)}>{segment.item.ownerName}</Tag> : null}
        {segment.item.onsiteOwnerName ? (
          <Tag tone={ownerTone(segment.item.onsiteOwnerName)}>{`${segment.item.onsiteOwnerName}·현장`}</Tag>
        ) : null}
        {segment.item.type === "source" ? (
          <Tag tone={segment.item.eventKind === "absence" ? "pink" : "gray"}>{sourceEventLabel(segment.item)}</Tag>
        ) : null}
        {segment.item.type === "request" ? <Tag tone="amber">요청</Tag> : null}
      </span>
      <strong>{segment.item.title}</strong>
    </>
  );

  if (segment.item.href) {
    return (
      <Link className={className} href={segment.item.href} style={style}>
        {content}
      </Link>
    );
  }

  return (
    <div className={className} style={style}>
      {content}
    </div>
  );
}

function buildCalendarWeeks(
  anchorDate: Date,
  operations: OperationSession[],
  calendarEvents: CalendarResourceEvent[],
  pendingRequestItems: CalendarItem[],
  teamQuery: string,
  ownerMap: Map<string, string>
): CalendarWeek[] {
  const days = buildCalendarDays(anchorDate);
  const items = [
    ...operations
      .map((operation) => operationToCalendarItem(operation, teamQuery, ownerMap))
      .filter((item): item is CalendarItem => item !== null),
    ...calendarEvents
      .map((event) => sourceEventToCalendarItem(event, ownerMap))
      .filter((item): item is CalendarItem => item !== null),
    ...pendingRequestItems
  ];

  return Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => {
    const weekDays = days.slice(index * 7, index * 7 + 7);

    return {
      days: weekDays,
      key: dateKey(weekDays[0].date),
      segments: buildCalendarWeekSegments(weekDays, items)
    };
  });
}

function buildCalendarDays(anchorDate: Date): CalendarDay[] {
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const endOffset = 6 - lastDay.getDay();
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

function buildCalendarWeekSegments(days: CalendarDay[], items: CalendarItem[]) {
  const weekStart = days[0].date;
  const weekEnd = days[days.length - 1].date;
  const candidates = items
    .map((item) => {
      if (item.startDate.getTime() > weekEnd.getTime() || item.endDate.getTime() < weekStart.getTime()) {
        return null;
      }

      const totalDuration = durationDays(item.startDate, item.endDate);
      const shouldRenderContinuously = totalDuration <= MAX_CALENDAR_CONTINUOUS_DAYS;
      const startInWeek = isWithinDateRange(item.startDate, weekStart, weekEnd);
      const endInWeek = isWithinDateRange(item.endDate, weekStart, weekEnd);

      if (!shouldRenderContinuously && !startInWeek && !endInWeek) {
        return null;
      }

      const segmentStart = shouldRenderContinuously ? maxDate(item.startDate, weekStart) : startInWeek ? item.startDate : item.endDate;
      const segmentEnd = shouldRenderContinuously ? minDate(item.endDate, weekEnd) : segmentStart;

      return {
        end: item.endDate,
        item,
        longSummary: !shouldRenderContinuously,
        segmentEnd,
        segmentStart,
        start: item.startDate
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => {
      const startDiff = a.segmentStart.getTime() - b.segmentStart.getTime();
      if (startDiff !== 0) return startDiff;
      const durationDiff = durationDays(b.segmentStart, b.segmentEnd) - durationDays(a.segmentStart, a.segmentEnd);
      if (durationDiff !== 0) return durationDiff;
      return compareStableText(a.item.title, b.item.title);
    });
  const laneEnds: number[] = [];

  return candidates.map((candidate) => {
    const startColumn = dateDiffDays(weekStart, candidate.segmentStart) + 1;
    const span = dateDiffDays(candidate.segmentStart, candidate.segmentEnd) + 1;
    const lane = findCalendarLane(laneEnds, startColumn);

    laneEnds[lane] = startColumn + span - 1;

    return {
      endsAfterWeek: candidate.end.getTime() > weekEnd.getTime(),
      item: candidate.item,
      key: `${candidate.item.key}-${dateKey(weekStart)}`,
      lane,
      longSummary: candidate.longSummary,
      span,
      startColumn,
      startsBeforeWeek: candidate.start.getTime() < weekStart.getTime()
    };
  });
}

function operationToCalendarItem(operation: OperationSession, teamQuery: string, ownerMap: Map<string, string>): CalendarItem | null {
  const startDate = parseDate(operation.startDate);
  const endDate = parseDate(operation.endDate);

  if (!startDate || !endDate) return null;

  const ownerName = getCalendarOperationOwner(operation.om, ownerMap);
  const onsiteOwnerName = getCalendarOperationOwner(operation.onsiteOm, ownerMap);

  return {
    endDate,
    href: `/operations/${operation.operationId}${teamQuery}`,
    key: `operation-${operation.operationId}`,
    onsiteOwnerName: onsiteOwnerName && onsiteOwnerName !== ownerName ? onsiteOwnerName : undefined,
    ownerName,
    startDate,
    title: operation.courseName,
    type: "operation"
  };
}

function sourceEventToCalendarItem(event: CalendarResourceEvent, ownerMap: Map<string, string>): CalendarItem | null {
  const startDate = parseCalendarEventDate(event.startDateTime);
  const endDate = parseCalendarEventEndDate(event.endDateTime, startDate);

  if (!startDate || !endDate) return null;

  return {
    endDate,
    eventKind: event.eventKind,
    key: `source-${normalizeOwnerName(event.ownerName)}-${event.sourceEventId}`,
    ownerName: resolveOwnerDisplayName(event.ownerName, ownerMap) ?? event.ownerName,
    startDate,
    title: event.title,
    type: "source"
  };
}

// 아직 operation으로 승격되지 않은 om-request도 회차(세션) 단위로 캘린더에 막대를 그린다.
function omRequestToCalendarItems(request: OmRequest, teamQuery: string, ownerMap: Map<string, string>): CalendarItem[] {
  const ownerName = getCalendarOperationOwner(request.assignedOm ?? "", ownerMap);

  return request.sessions.flatMap((session, index) => {
    const startDate = parseDate(session.date);
    const endDate = parseDate(session.dateEnd ?? session.date) ?? startDate;
    if (!startDate || !endDate) return [];

    return [{
      endDate,
      href: `/om-request/manage/${request.id}${teamQuery}`,
      key: `request-${request.id}-${index}`,
      ownerName,
      startDate,
      title: request.courseName,
      type: "request" as const
    }];
  });
}

function isCalendarItemInWindow(item: CalendarItem, viewDate: Date) {
  const windowStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const windowEnd = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);

  return item.startDate.getTime() <= windowEnd.getTime() && windowStart.getTime() <= item.endDate.getTime();
}

function findCalendarLane(laneEnds: number[], startColumn: number) {
  const reusableLane = laneEnds.findIndex((endColumn) => endColumn < startColumn);
  return reusableLane >= 0 ? reusableLane : laneEnds.length;
}

function parseDate(value: string) {
  if (!value) return null;

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day);
}

function parseCalendarEventDate(value: string) {
  if (!value) return null;
  if (!value.includes("T")) return parseDate(value.slice(0, 10));

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseCalendarEventEndDate(value: string, startDate: Date | null) {
  const endDate = parseCalendarEventDate(value);
  if (!endDate) return startDate;

  if (value && !value.includes("T") && startDate && endDate.getTime() > startDate.getTime()) {
    const inclusiveEndDate = new Date(endDate);
    inclusiveEndDate.setDate(endDate.getDate() - 1);
    return inclusiveEndDate;
  }

  return endDate;
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

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort(compareStableText);
}

function buildOwnerDisplayMap(owners: string[]) {
  return new Map(owners.map((owner) => [normalizeOwnerName(owner), owner]));
}

function getRosterOwners(ownerRoster: ResourceOwnerRoster) {
  return unique(Object.values(ownerRoster).flatMap((owners) => owners ?? []));
}

function buildOwnerPartMap(partRoster: OmAvailabilityRoster) {
  const map = new Map<string, string>();

  for (const [part, names] of Object.entries(partRoster)) {
    for (const name of names ?? []) {
      map.set(normalizeOwnerName(name), part);
    }
  }

  return map;
}

function getOwnerPart(owner: string, ownerPartMap: Map<string, string>) {
  return ownerPartMap.get(normalizeOwnerName(owner)) ?? UNCLASSIFIED_PART;
}

function ownerNamesInScope(
  ownerNames: string[],
  effectiveOwnerFilter: string,
  partFilter: string,
  ownerPartMap: Map<string, string>
) {
  if (effectiveOwnerFilter !== "전체 담당자") return ownerNames.includes(effectiveOwnerFilter);
  if (partFilter === ALL_PARTS_FILTER) return true;

  return ownerNames.some((name) => getOwnerPart(name, ownerPartMap) === partFilter);
}

function isInCalendarWindow(operation: OperationSession, viewDate: Date) {
  const start = parseDate(operation.startDate);
  const end = parseDate(operation.endDate);
  if (!start || !end) return false;

  const windowStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const windowEnd = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);

  return start.getTime() <= windowEnd.getTime() && windowStart.getTime() <= end.getTime();
}

function isCalendarEventInWindow(event: CalendarResourceEvent, viewDate: Date) {
  const start = parseCalendarEventDate(event.startDateTime);
  const end = parseCalendarEventEndDate(event.endDateTime, start);
  if (!start || !end) return false;

  const windowStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const windowEnd = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);

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

function sourceEventLabel(item: CalendarItem) {
  if (item.eventKind === "absence") return "부재";
  if (item.eventKind === "nearby_workload") return "주변 일정";
  return "캘린더";
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

function getResourceOwners(value: string, allowedOwners: Map<string, string>) {
  const owners = splitPersonNames(value)
    .map((owner) => resolveOwnerDisplayName(owner, allowedOwners))
    .filter((owner): owner is string => Boolean(owner));

  const uniqueOwners = unique(owners);
  return uniqueOwners.includes(UNMATCHED_OWNER) ? [UNMATCHED_OWNER] : uniqueOwners;
}

// 과정 담당 OM(om)과 실제 현장 강의관리자(onsiteOm) 둘 다의 리소스 화면 담당자를 합친다.
// 현장운영으로만 지정된 사람도 자신의 캘린더/목록에서 해당 운영을 볼 수 있어야 한다.
function getOperationResourceOwners(operation: OperationSession, allowedOwners: Map<string, string>) {
  return unique([
    ...getResourceOwners(operation.om, allowedOwners),
    ...getResourceOwners(operation.onsiteOm, allowedOwners)
  ]);
}

function getCalendarOperationOwner(value: string, allowedOwners: Map<string, string>) {
  return (
    splitPersonNames(value, "")
      .map((owner) => resolveOwnerDisplayName(owner, allowedOwners, false))
      .find((owner): owner is string => Boolean(owner)) ?? ""
  );
}

function resolveOwnerDisplayName(owner: string, allowedOwners: Map<string, string>, includeFallback = true) {
  const directOwner = allowedOwners.get(normalizeOwnerName(owner));
  if (directOwner) return directOwner;

  const aliasOwner = OWNER_ALIASES[normalizeOwnerName(owner)];
  if (aliasOwner) return allowedOwners.get(normalizeOwnerName(aliasOwner)) ?? null;

  if (!includeFallback) return null;
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
