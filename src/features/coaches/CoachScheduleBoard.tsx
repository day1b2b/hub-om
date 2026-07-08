"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { CoachScheduleDashboard, CoachScheduleDashboardCoach } from "@/lib/data/coachTypes";

interface CoachScheduleBoardProps {
  dashboard: CoachScheduleDashboard;
  loadFailed: boolean;
}

const TIME_FILTERS = [
  { key: "all", label: "전체", title: "전체 가능", startMinutes: 0, endMinutes: 24 * 60 },
  { key: "08-13", label: "오전", title: "오전 가능", startMinutes: 8 * 60, endMinutes: 13 * 60 },
  { key: "13-18", label: "오후", title: "오후 가능", startMinutes: 13 * 60, endMinutes: 18 * 60 },
  { key: "18-22", label: "저녁", title: "저녁 가능", startMinutes: 18 * 60, endMinutes: 22 * 60 }
] as const;

type TimeFilterKey = (typeof TIME_FILTERS)[number]["key"];

export function CoachScheduleBoard({ dashboard, loadFailed }: CoachScheduleBoardProps) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<string | null>(() => defaultSelectedDate(dashboard));
  const [timeFilter, setTimeFilter] = useState<TimeFilterKey>("all");
  const [query, setQuery] = useState("");

  const monthDate = useMemo(() => parseYearMonth(dashboard.yearMonth), [dashboard.yearMonth]);
  const selectedDay = selectedDate ? dashboard.days[selectedDate] : null;
  const monthCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [date, day] of Object.entries(dashboard.days)) {
      counts[date] = day.coaches.filter((coach) => coachMatchesTimeFilter(coach, timeFilter)).length;
    }
    return counts;
  }, [dashboard.days, timeFilter]);
  const filteredCoaches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (selectedDay?.coaches ?? []).filter((coach) => {
      if (!coachMatchesTimeFilter(coach, timeFilter)) return false;
      if (!normalizedQuery) return true;
      return [
        coach.name,
        coach.workType ?? "",
        ...coach.fields,
        ...coach.recentEngagements.map((engagement) => engagement.courseName)
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [query, selectedDay?.coaches, timeFilter]);
  const totalAvailableDays = Object.values(monthCounts).filter((count) => count > 0).length;

  function moveMonth(offset: number) {
    const next = new Date(Date.UTC(monthDate.year, monthDate.monthIndex + offset, 1));
    router.push(`/coaches/schedule?yearMonth=${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  function goToday() {
    const today = formatDate(new Date());
    if (today.startsWith(dashboard.yearMonth)) {
      setSelectedDate(today);
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
                const isSelected = date === selectedDate;
                const dateObject = new Date(`${date}T00:00:00`);
                const isWeekend = dateObject.getDay() === 0 || dateObject.getDay() === 6;
                const intensity = count >= 20 ? "high" : count >= 10 ? "medium" : count > 0 ? "low" : "none";

                return (
                  <button
                    aria-pressed={isSelected}
                    className={[
                      "coach-calendar-day",
                      isSelected ? "selected" : "",
                      isWeekend ? "weekend" : "",
                      `intensity-${intensity}`
                    ].filter(Boolean).join(" ")}
                    key={date}
                    onClick={() => setSelectedDate(date)}
                    type="button"
                  >
                    <span>{Number(date.slice(-2))}</span>
                    <strong>{count > 0 ? count : "-"}</strong>
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
              <span>이름순 정렬</span>
            </div>

            {loadFailed ? (
              <div className="coach-doc-empty">
                <strong>코치 일정 데이터를 불러오지 못했습니다.</strong>
                <span>배포 DB 연결과 코치 import 상태를 확인하세요.</span>
              </div>
            ) : !selectedDate ? (
              <div className="coach-doc-empty">
                <strong>조회할 날짜를 선택하세요.</strong>
                <span>달력에서 날짜를 누르면 해당 날짜의 가능 코치가 표시됩니다.</span>
              </div>
            ) : filteredCoaches.length === 0 ? (
              <div className="coach-doc-empty">
                <strong>조건에 맞는 가능 코치가 없습니다.</strong>
                <span>다른 날짜, 시간대, 검색어를 선택하세요.</span>
              </div>
            ) : (
              <div className="coach-doc-rows">
                {filteredCoaches.map((coach) => (
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

function defaultSelectedDate(dashboard: CoachScheduleDashboard): string | null {
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
  return schedules.map((schedule) => `${schedule.startTime}~${schedule.endTime}`).join(", ");
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
