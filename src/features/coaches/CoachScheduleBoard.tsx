"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type {
  CoachDayReservationView,
  CoachScheduleDashboard,
  CoachScheduleDashboardCoach,
  CoachScheduleDashboardDay
} from "@/lib/data/coachTypes";
import type { HolidayMap } from "@/lib/holidayApi";

interface CoachScheduleBoardProps {
  currentUserEmail: string;
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


export function CoachScheduleBoard({ currentUserEmail, dashboard, holidays, loadFailed, initialDate }: CoachScheduleBoardProps) {
  const router = useRouter();

  // 선택 날짜들 (0개: 안내, 1개: 단일 날짜, 2개 이상: 다중 필터)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => {
    const d = defaultSelectedDate(dashboard, initialDate);
    return d ? new Set([d]) : new Set();
  });
  // 여러 날짜 선택 모드 (연속·비연속 모두 개별 클릭으로 추가/제거)
  const [rangeMode, setRangeMode] = useState(false);

  const [timeFilter, setTimeFilter] = useState<TimeFilterKey>("all");
  const [reservingKey, setReservingKey] = useState<string | null>(null);

  // 달 이동 시에도 이전에 조회했던 달의 선택 날짜를 계속 조합할 수 있도록 달별 일정 데이터를 누적한다.
  // (렌더 중 상태 조정: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  const [daysCache, setDaysCache] = useState<Record<string, CoachScheduleDashboardDay>>(() => ({ ...dashboard.days }));
  const [cachedDashboardDays, setCachedDashboardDays] = useState(dashboard.days);
  if (dashboard.days !== cachedDashboardDays) {
    setCachedDashboardDays(dashboard.days);
    setDaysCache((prev) => ({ ...prev, ...dashboard.days }));
  }

  const monthDate = useMemo(() => parseYearMonth(dashboard.yearMonth), [dashboard.yearMonth]);
  const sortedSelected = useMemo(() => [...selectedDates].sort(), [selectedDates]);
  const isSingleDate = selectedDates.size === 1;
  const isMultiDate = selectedDates.size > 1;
  const singleDate = isSingleDate ? sortedSelected[0]! : null;
  const singleDay = singleDate ? daysCache[singleDate] : null;

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
    return (singleDay?.coaches ?? []).filter((coach) => coachMatchesTimeFilter(coach, timeFilter));
  }, [singleDay?.coaches, timeFilter]);

  // 다중 날짜: 선택 날짜 중 데이터를 불러온 적 있는 날짜(다른 달로 이동해 조회한 날짜 포함)
  const activeDays = useMemo(() => sortedSelected.filter((d) => daysCache[d]), [sortedSelected, daysCache]);

  // 다중 날짜: 선택 날짜 모두 가능한 코치 (다른 달에서 선택한 날짜도 함께 조합)
  const multiDateCoaches = useMemo(() => {
    if (!isMultiDate || activeDays.length === 0) return [];
    const coachDayCounts = new Map<string, number>();
    const coachData = new Map<string, CoachScheduleDashboardCoach>();
    for (const date of activeDays) {
      const day = daysCache[date];
      for (const coach of day.coaches) {
        if (!coachMatchesTimeFilter(coach, timeFilter)) continue;
        coachDayCounts.set(coach.id, (coachDayCounts.get(coach.id) ?? 0) + 1);
        if (!coachData.has(coach.id)) coachData.set(coach.id, coach);
      }
    }
    return [...coachDayCounts.entries()]
      .filter(([, count]) => count === activeDays.length)
      .map(([id]) => coachData.get(id)!)
      .filter(Boolean)
      .sort((a, b) => {
        if (a.engagementCount !== b.engagementCount) return b.engagementCount - a.engagementCount;
        return a.name.localeCompare(b.name, "ko");
      });
  }, [isMultiDate, activeDays, daysCache, timeFilter]);

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

  // 같은 코치·날짜를 여러 매니저가 중복으로 연락하지 않도록 남기는 가벼운 예약 표시.
  // 서버는 요청한 날짜별 "최종 예약자"를 항상 돌려주므로, 성공/충돌을 구분해 알리지 않고
  // 그 결과를 그대로 화면에 반영한다(이미 다른 매니저가 예약 중이면 그 이름이 바로 표시됨).
  function applyReservationPatch(coachId: string, date: string, reservation: CoachDayReservationView | null) {
    setDaysCache((prev) => {
      const day = prev[date];
      if (!day) return prev;
      const coaches = day.coaches.map((c) => (c.id === coachId ? { ...c, reservation } : c));
      return { ...prev, [date]: { ...day, coaches } };
    });
  }

  // 단일 날짜 화면에서는 dates가 1개, 다중 날짜 화면에서는 선택 날짜별로 각각 1개씩 호출한다.
  async function handleReserve(coachId: string, dates: string[]) {
    const key = `${coachId}__${dates.join(",")}`;
    setReservingKey(key);
    try {
      const response = await fetch(`/api/coaches/${coachId}/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates })
      });
      if (response.ok) {
        const body = (await response.json()) as {
          results: Array<{ date: string; reservedByName: string; reservedByEmail: string }>;
        };
        for (const r of body.results) {
          applyReservationPatch(coachId, r.date, { reservedByName: r.reservedByName, reservedByEmail: r.reservedByEmail });
        }
      } else {
        alert("예약하지 못했습니다.");
      }
    } catch {
      alert("예약하지 못했습니다.");
    } finally {
      setReservingKey(null);
    }
  }

  async function handleCancelReservation(coachId: string, dates: string[]) {
    if (!confirm(dates.length > 1 ? "선택한 날짜의 예약을 모두 취소하시겠습니까?" : "예약을 취소하시겠습니까?")) return;
    const key = `${coachId}__${dates.join(",")}`;
    setReservingKey(key);
    try {
      const response = await fetch(`/api/coaches/${coachId}/reservations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates })
      });
      if (response.ok) {
        const body = (await response.json()) as { cancelledDates: string[] };
        for (const date of body.cancelledDates) {
          applyReservationPatch(coachId, date, null);
        }
      } else {
        alert("취소하지 못했습니다.");
      }
    } catch {
      alert("취소하지 못했습니다.");
    } finally {
      setReservingKey(null);
    }
  }

  function reservationOn(coachId: string, date: string) {
    return daysCache[date]?.coaches.find((c) => c.id === coachId)?.reservation ?? null;
  }

  return (
    <main className="dashboard-shell coach-schedule-shell">
      <AppSidebar label="Coach schedule" teamScope="both" />

      <section className="content coach-schedule-workspace" id="coach-schedule">
        <header className="coach-workspace-header">
          <div>
            <h1>코치 일정</h1>
            <span className="coach-plan-badge">coach-db</span>
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
                : "선택한 날짜에 가능한 코치 없음"}
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
                <strong>선택한 날짜의 데이터가 없습니다.</strong>
                <span>다른 날짜를 선택하거나 월을 이동해 이어서 선택하세요.</span>
              </div>
            ) : isMultiDate && multiDateCoaches.length === 0 ? (
              <div className="coach-doc-empty">
                <strong>선택한 날짜 모두 가능한 코치가 없습니다.</strong>
                <span>날짜를 조정하거나 시간대·검색어를 바꿔보세요.</span>
              </div>
            ) : isMultiDate ? (
              <div className="coach-doc-rows">
                {multiDateCoaches.map((coach) => (
                  <div className="coach-doc-row" key={coach.id}>
                    <Link className="coach-doc-identity" href={`/coaches/${coach.id}`}>
                      <span className="coach-doc-icon">{coach.name.slice(0, 1)}</span>
                      <span className="coach-doc-main">
                        <strong>{coach.name}</strong>
                        <small>
                          <b>{coach.workType || "근무유형 없음"}</b>
                          {coach.fields.length > 0 && <> · {coach.fields.slice(0, 3).join(", ")}</>}
                          <> · {formatScheduleLabel(coach.schedules)}</>
                          <> · {latestEngagementLabel(coach)}</>
                        </small>
                      </span>
                    </Link>
                    <span className="coach-doc-reserve coach-doc-reserve-chips">
                      {activeDays.map((date) => {
                        const reservation = reservationOn(coach.id, date);
                        const isBusy = reservingKey === `${coach.id}__${date}`;
                        const dayLabel = date.slice(5).replace("-", "/");
                        return reservation ? (
                          <span className="coach-doc-reserve-chip reserved" key={date} title={reservation.reservedByEmail}>
                            {dayLabel} · {reservation.reservedByName}
                            {reservation.reservedByEmail === currentUserEmail && (
                              <button
                                aria-label={`${dayLabel} 예약 취소`}
                                disabled={isBusy}
                                onClick={() => handleCancelReservation(coach.id, [date])}
                                type="button"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ) : (
                          <button
                            className="coach-doc-reserve-chip"
                            disabled={isBusy}
                            key={date}
                            onClick={() => handleReserve(coach.id, [date])}
                            type="button"
                          >
                            {isBusy ? "..." : `${dayLabel} 예약`}
                          </button>
                        );
                      })}
                    </span>
                  </div>
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
                {singleDateCoaches.map((coach) => {
                  const reservation = coach.reservation;
                  const isBusy = reservingKey === `${coach.id}__${singleDate}`;
                  return (
                    <div className="coach-doc-row" key={coach.id}>
                      <Link className="coach-doc-identity" href={`/coaches/${coach.id}`}>
                        <span className="coach-doc-icon">{coach.name.slice(0, 1)}</span>
                        <span className="coach-doc-main">
                          <strong>{coach.name}</strong>
                          <small>
                            <b>{coach.workType || "근무유형 없음"}</b>
                            {coach.fields.length > 0 && <> · {coach.fields.slice(0, 3).join(", ")}</>}
                            <> · {formatScheduleLabel(coach.schedules)}</>
                            <> · {latestEngagementLabel(coach)}</>
                          </small>
                        </span>
                      </Link>
                      <span className="coach-doc-reserve coach-doc-reserve-chips">
                        {reservation ? (
                          <span className="coach-doc-reserve-chip reserved" title={reservation.reservedByEmail}>
                            {singleDate!.slice(5).replace("-", "/")} · {reservation.reservedByName}
                            {reservation.reservedByEmail === currentUserEmail && (
                              <button
                                aria-label="예약 취소"
                                disabled={isBusy}
                                onClick={() => handleCancelReservation(coach.id, [singleDate!])}
                                type="button"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ) : (
                          <button
                            className="coach-doc-reserve-chip"
                            disabled={isBusy}
                            onClick={() => handleReserve(coach.id, [singleDate!])}
                            type="button"
                          >
                            {isBusy ? "예약 중..." : `${singleDate!.slice(5).replace("-", "/")} 예약`}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
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
