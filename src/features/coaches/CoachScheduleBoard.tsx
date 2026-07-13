"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { CoachScheduleDashboard, CoachScheduleDashboardCoach } from "@/lib/data/coachTypes";
import type { HolidayMap } from "@/lib/holidayApi";

interface CoachScheduleBoardProps {
  dashboard: CoachScheduleDashboard;
  holidays: HolidayMap;
  loadFailed: boolean;
  initialDate?: string;
}

const TIME_FILTERS = [
  { key: "all", label: "전체", title: "전체 가능", startMinutes: 0, endMinutes: 24 * 60 },
  { key: "08-12", label: "오전", title: "오전 가능", startMinutes: 8 * 60, endMinutes: 12 * 60 },
  { key: "13-18", label: "오후", title: "오후 가능", startMinutes: 13 * 60, endMinutes: 18 * 60 },
  { key: "19-22", label: "저녁", title: "저녁 가능", startMinutes: 19 * 60, endMinutes: 22 * 60 }
] as const;

type TimeFilterKey = (typeof TIME_FILTERS)[number]["key"];


export function CoachScheduleBoard({ dashboard, holidays, loadFailed, initialDate }: CoachScheduleBoardProps) {
  const router = useRouter();

  // 선택 날짜들 (0개: 안내, 1개: 단일 날짜, 2개 이상: 다중 필터)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => {
    const d = defaultSelectedDate(dashboard, initialDate);
    return d ? new Set([d]) : new Set();
  });
  // 여러 날짜 선택 모드 (연속·비연속 모두 개별 클릭으로 추가/제거)
  const [rangeMode, setRangeMode] = useState(false);

  const [timeFilter, setTimeFilter] = useState<TimeFilterKey>("all");
  const [query, setQuery] = useState("");

  const monthDate = useMemo(() => parseYearMonth(dashboard.yearMonth), [dashboard.yearMonth]);
  const sortedSelected = useMemo(() => [...selectedDates].sort(), [selectedDates]);
  const isSingleDate = selectedDates.size === 1;
  const isMultiDate = selectedDates.size > 1;
  const singleDate = isSingleDate ? sortedSelected[0]! : null;
  const singleDay = singleDate ? dashboard.days[singleDate] : null;

  const monthCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [date, day] of Object.entries(dashboard.days)) {
      counts[date] = day.coaches.filter((coach) => coachMatchesTimeFilter(coach, timeFilter)).length;
    }
    return counts;
  }, [dashboard.days, timeFilter]);

  const totalAvailableDays = Object.values(monthCounts).filter((count) => count > 0).length;

  // 단일 날짜 코치 목록
  const singleDateCoaches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (singleDay?.coaches ?? []).filter((coach) => {
      if (!coachMatchesTimeFilter(coach, timeFilter)) return false;
      if (!normalizedQuery) return true;
      return [coach.name, coach.workType ?? "", ...coach.fields, ...coach.recentEngagements.map((e) => e.courseName)]
        .some((v) => v.toLowerCase().includes(normalizedQuery));
    });
  }, [query, singleDay?.coaches, timeFilter]);

  // 다중 날짜: 선택 날짜 중 이번 달 데이터 있는 날짜
  const activeDays = useMemo(() => sortedSelected.filter((d) => dashboard.days[d]), [sortedSelected, dashboard.days]);

  // 다중 날짜: 선택 날짜 모두 가능한 코치
  const multiDateCoaches = useMemo(() => {
    if (!isMultiDate || activeDays.length === 0) return [];
    const coachDayCounts = new Map<string, number>();
    const coachData = new Map<string, CoachScheduleDashboardCoach>();
    for (const date of activeDays) {
      const day = dashboard.days[date];
      for (const coach of day.coaches) {
        if (!coachMatchesTimeFilter(coach, timeFilter)) continue;
        coachDayCounts.set(coach.id, (coachDayCounts.get(coach.id) ?? 0) + 1);
        if (!coachData.has(coach.id)) coachData.set(coach.id, coach);
      }
    }
    const normalizedQuery = query.trim().toLowerCase();
    return [...coachDayCounts.entries()]
      .filter(([, count]) => count === activeDays.length)
      .map(([id]) => coachData.get(id)!)
      .filter(Boolean)
      .filter((coach) => {
        if (!normalizedQuery) return true;
        return [coach.name, coach.workType ?? "", ...coach.fields, ...coach.recentEngagements.map((e) => e.courseName)]
          .some((v) => v.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => {
        if (a.engagementCount !== b.engagementCount) return b.engagementCount - a.engagementCount;
        return a.name.localeCompare(b.name, "ko");
      });
  }, [isMultiDate, activeDays, dashboard.days, timeFilter, query]);

  function handleCalendarClick(date: string) {
    if (rangeMode) {
      // 여러 날짜 선택 모드: 연속이든 띄엄띄엄이든 클릭한 날짜만 개별로 추가/제거.
      setSelectedDates((prev) => {
        const next = new Set(prev);
        if (next.has(date)) next.delete(date);
        else next.add(date);
        return next;
      });
    } else {
      setSelectedDates((prev) => {
        // 여러 날짜 선택 모드 밖에서는 클릭 한 번에 그 날짜 하나만 선택(이전 선택 교체).
        // 같은 날짜를 다시 클릭하면 선택 해제.
        if (prev.size === 1 && prev.has(date)) return new Set();
        return new Set([date]);
      });
    }
  }

  function clearSelection() {
    setSelectedDates(new Set());
  }

  function toggleRangeMode() {
    setRangeMode((prev) => !prev);
  }

  function moveMonth(offset: number) {
    const next = new Date(Date.UTC(monthDate.year, monthDate.monthIndex + offset, 1));
    router.push(`/coaches/schedule?yearMonth=${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  function goToday() {
    const today = formatDate(new Date());
    if (today.startsWith(dashboard.yearMonth)) {
      setSelectedDates(new Set([today]));
      return;
    }
    router.push(`/coaches/schedule?yearMonth=${today.slice(0, 7)}`);
  }

  return (
    <main className="dashboard-shell coach-schedule-shell">
      <AppSidebar label="Coach schedule" teamScope="both" />

      <section className="content coach-schedule-workspace" id="coach-schedule">
        <div className="coach-schedule-topbar">
          <label className="coach-schedule-search">
            <span aria-hidden="true">⌕</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="코치, 분야, 과정 검색"
              type="search"
              value={query}
            />
          </label>
          <div className="coach-schedule-topnav">
            <Link href="/coaches">코치 목록</Link>
          </div>
        </div>

        <header className="coach-workspace-header">
          <div>
            <h1>코치 일정</h1>
            <span className="coach-plan-badge">hub-om</span>
          </div>
          <div className="coach-workspace-actions">
            <button onClick={goToday} type="button">오늘</button>
          </div>
        </header>

        <div className="coach-date-range-bar">
          <span className="coach-date-range-label">기간 검색</span>
          <button
            className={["coach-date-range-mode", rangeMode ? "active" : ""].filter(Boolean).join(" ")}
            onClick={toggleRangeMode}
            title={rangeMode ? "다중 선택 모드 해제" : "다중 선택 모드: 연속·비연속 날짜를 각각 클릭해 조합 선택"}
            type="button"
          >
            {rangeMode ? "다중 선택 중" : "다중 선택"}
          </button>
          {rangeMode ? (
            <span className="coach-date-range-hint">날짜를 클릭해 추가·제거 · 연속이 아니어도 됩니다</span>
          ) : (
            <span className="coach-date-range-hint">날짜를 클릭해 선택</span>
          )}
          {isMultiDate && (
            <span className="coach-date-range-result">
              {activeDays.length > 0
                ? `${activeDays.length}일 모두 가능 ${multiDateCoaches.length}명`
                : "이 달에 선택한 날짜 없음"}
            </span>
          )}
          {selectedDates.size > 0 && (
            <button className="coach-date-range-clear" onClick={clearSelection} type="button">
              초기화
            </button>
          )}
        </div>

        <section className="coach-schedule-doc-area">
          <section className="coach-calendar-doc" aria-label="월별 코치 일정">
            <div className="coach-calendar-header">
              <button aria-label="이전 달" onClick={() => moveMonth(-1)} type="button">‹</button>
              <strong>{monthDate.year}년 {monthDate.monthIndex + 1}월</strong>
              <button aria-label="다음 달" onClick={() => moveMonth(1)} type="button">›</button>
            </div>
            <div className="coach-calendar-weekdays" aria-hidden="true">
              {["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="coach-calendar-grid">
              {buildCalendarCells(monthDate.year, monthDate.monthIndex).map((date, index) => {
                if (!date) return <span aria-hidden="true" className="coach-calendar-empty-day" key={`empty-${index}`} />;

                const count = monthCounts[date] ?? 0;
                const isSelected = selectedDates.has(date);
                const dateObject = new Date(`${date}T00:00:00`);
                const isWeekend = dateObject.getDay() === 0 || dateObject.getDay() === 6;
                const intensity = count >= 20 ? "high" : count >= 10 ? "medium" : count > 0 ? "low" : "none";
                const holiday = holidays[date];

                return (
                  <button
                    aria-pressed={isSelected}
                    className={[
                      "coach-calendar-day",
                      isSelected ? "selected" : "",
                      isWeekend ? "weekend" : "",
                      holiday ? "holiday" : "",
                      `intensity-${intensity}`,
                    ].filter(Boolean).join(" ")}
                    key={date}
                    onClick={() => handleCalendarClick(date)}
                    title={holiday ?? undefined}
                    type="button"
                  >
                    <span>{Number(date.slice(-2))}</span>
                    <strong>{count > 0 ? count : "-"}</strong>
                    {holiday && <em className="coach-calendar-holiday-dot" aria-hidden="true" />}
                    {isSelected && isMultiDate && <em className="coach-calendar-check" aria-hidden="true">✓</em>}
                  </button>
                );
              })}
            </div>
            <div className="coach-calendar-foot">
              <span>가용일 {totalAvailableDays}일</span>
              <span>활동 코치 {dashboard.totalActiveCoaches}명</span>
            </div>
          </section>

          <section className="coach-doc-list" aria-label="선택 날짜 가능 코치">
            <div className="coach-doc-tabs">
              {TIME_FILTERS.map((filter) => (
                <button
                  className={timeFilter === filter.key ? "selected" : ""}
                  key={filter.key}
                  onClick={() => setTimeFilter(filter.key)}
                  type="button"
                >
                  {filter.label}
                </button>
              ))}
              <span>투입 많은 순 정렬</span>
            </div>

            {loadFailed ? (
              <div className="coach-doc-empty">
                <strong>코치 일정 데이터를 불러오지 못했습니다.</strong>
                <span>배포 DB 연결과 코치 import 상태를 확인하세요.</span>
              </div>
            ) : isMultiDate && activeDays.length === 0 ? (
              <div className="coach-doc-empty">
                <strong>이 달에 선택한 날짜의 데이터가 없습니다.</strong>
                <span>다른 날짜를 선택하거나 월을 이동하세요.</span>
              </div>
            ) : isMultiDate && multiDateCoaches.length === 0 ? (
              <div className="coach-doc-empty">
                <strong>선택한 날짜 모두 가능한 코치가 없습니다.</strong>
                <span>날짜를 조정하거나 시간대·검색어를 바꿔보세요.</span>
              </div>
            ) : isMultiDate ? (
              <div className="coach-doc-rows">
                {multiDateCoaches.map((coach) => (
                  <Link className="coach-doc-row" href={`/coaches/${coach.id}`} key={coach.id}>
                    <span className="coach-doc-icon">{coach.name.slice(0, 1)}</span>
                    <span className="coach-doc-main">
                      <strong>{coach.name}</strong>
                      <small>
                        <b>{coach.workType || "근무유형 없음"}</b>
                        {coach.fields.length > 0 && <> · {coach.fields.slice(0, 3).join(", ")}</>}
                        <> · {latestEngagementLabel(coach)}</>
                      </small>
                    </span>
                    <span className="coach-doc-time">{formatScheduleLabel(coach.schedules)}</span>
                  </Link>
                ))}
              </div>
            ) : !singleDate ? (
              <div className="coach-doc-empty">
                <strong>조회할 날짜를 선택하세요.</strong>
                <span>달력에서 날짜를 누르면 해당 날짜의 가능 코치가 표시됩니다.</span>
              </div>
            ) : singleDateCoaches.length === 0 ? (
              <div className="coach-doc-empty">
                <strong>조건에 맞는 가능 코치가 없습니다.</strong>
                <span>다른 날짜, 시간대, 검색어를 선택하세요.</span>
              </div>
            ) : (
              <div className="coach-doc-rows">
                {singleDateCoaches.map((coach) => (
                  <Link className="coach-doc-row" href={`/coaches/${coach.id}`} key={coach.id}>
                    <span className="coach-doc-icon">{coach.name.slice(0, 1)}</span>
                    <span className="coach-doc-main">
                      <strong>{coach.name}</strong>
                      <small>
                        <b>{coach.workType || "근무유형 없음"}</b>
                        {coach.fields.length > 0 && <> · {coach.fields.slice(0, 3).join(", ")}</>}
                        <> · {latestEngagementLabel(coach)}</>
                      </small>
                    </span>
                    <span className="coach-doc-time">{formatScheduleLabel(coach.schedules)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}

function defaultSelectedDate(dashboard: CoachScheduleDashboard, initialDate?: string): string | null {
  if (initialDate && initialDate.startsWith(dashboard.yearMonth)) return initialDate;
  const today = formatDate(new Date());
  if (today.startsWith(dashboard.yearMonth)) return today;
  return Object.keys(dashboard.days).sort()[0] ?? null;
}

function parseYearMonth(yearMonth: string): { year: number; monthIndex: number } {
  const [year, month] = yearMonth.split("-").map(Number);
  return { year, monthIndex: month - 1 };
}

function buildCalendarCells(year: number, monthIndex: number): Array<string | null> {
  const firstDayOfWeek = new Date(year, monthIndex, 1).getDay();
  const lastDate = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<string | null> = [];

  for (let index = 0; index < firstDayOfWeek; index += 1) cells.push(null);
  for (let day = 1; day <= lastDate; day += 1) {
    cells.push(`${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length < 42) cells.push(null);
  return cells;
}

function coachMatchesTimeFilter(coach: CoachScheduleDashboardCoach, filter: TimeFilterKey): boolean {
  if (filter === "all") return coach.schedules.length > 0;
  const preset = TIME_FILTERS.find((item) => item.key === filter);
  if (!preset) return true;
  return coach.schedules.some((schedule) => {
    const start = toMinutes(schedule.startTime);
    const end = toMinutes(schedule.endTime);
    return start < preset.endMinutes && end > preset.startMinutes;
  });
}

function toMinutes(time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatScheduleLabel(schedules: CoachScheduleDashboardCoach["schedules"]): string {
  if (schedules.length === 0) return "가능시간 없음";

  const periods = TIME_FILTERS.filter((filter) => filter.key !== "all");
  const matchedLabels = periods.filter((period) =>
    schedules.some((schedule) => {
      const start = toMinutes(schedule.startTime);
      const end = toMinutes(schedule.endTime);
      return start < period.endMinutes && end > period.startMinutes;
    })
  );

  if (matchedLabels.length === 0) {
    return schedules.map((schedule) => `${schedule.startTime}~${schedule.endTime}`).join(", ");
  }
  return matchedLabels.map((period) => period.label).join(" · ");
}

function latestEngagementLabel(coach: CoachScheduleDashboardCoach): string {
  const latest = coach.recentEngagements[0];
  if (!latest) return `투입 ${coach.engagementCount}건`;

  const cleanName = latest.courseName
    .replace(/\[부가세\s*별도\]\s*/g, "")
    .replace(/\(B2B\)\s*/g, "")
    .replace(/_/g, " ")
    .trim();
  return `${cleanName || "최근 과정"} · 총 ${coach.engagementCount}건`;
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const date = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}
