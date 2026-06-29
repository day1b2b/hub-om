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
  { key: "all", label: "전체", startMinutes: 0, endMinutes: 24 * 60 },
  { key: "08-13", label: "오전", startMinutes: 8 * 60, endMinutes: 13 * 60 },
  { key: "13-18", label: "오후", startMinutes: 13 * 60, endMinutes: 18 * 60 },
  { key: "18-22", label: "저녁", startMinutes: 18 * 60, endMinutes: 22 * 60 }
] as const;

type TimeFilterKey = (typeof TIME_FILTERS)[number]["key"];

export function CoachScheduleBoard({ dashboard, loadFailed }: CoachScheduleBoardProps) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<string | null>(() => defaultSelectedDate(dashboard));
  const [timeFilter, setTimeFilter] = useState<TimeFilterKey>("all");

  const monthDate = useMemo(() => parseYearMonth(dashboard.yearMonth), [dashboard.yearMonth]);
  const selectedDay = selectedDate ? dashboard.days[selectedDate] : null;
  const filteredCoaches = useMemo(() => {
    return (selectedDay?.coaches ?? []).filter((coach) => coachMatchesTimeFilter(coach, timeFilter));
  }, [selectedDay?.coaches, timeFilter]);
  const monthCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [date, day] of Object.entries(dashboard.days)) {
      counts[date] = day.coaches.filter((coach) => coachMatchesTimeFilter(coach, timeFilter)).length;
    }
    return counts;
  }, [dashboard.days, timeFilter]);
  const totalAvailableDays = Object.values(monthCounts).filter((count) => count > 0).length;

  function moveMonth(offset: number) {
    const next = new Date(Date.UTC(monthDate.year, monthDate.monthIndex + offset, 1));
    router.push(`/coaches/schedule?yearMonth=${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Coach schedule" teamScope="both" />

      <section className="content operations-page coach-schedule-page" id="coach-schedule">
        <header className="page-header">
          <div>
            <p className="eyebrow">코치 일정</p>
            <h1>코치 일정</h1>
            <p className="lede">coach-db의 일정 중심 화면을 hub-om 데이터로 재구성했습니다. 연락처 등 개인정보는 표시하지 않습니다.</p>
          </div>
          <div className="header-panel">
            <span>활동 코치</span>
            <strong>{dashboard.totalActiveCoaches}명</strong>
          </div>
        </header>

        <section className="coach-schedule-layout">
          <section className="dashboard-panel coach-schedule-calendar" aria-label="월별 코치 일정">
            <div className="coach-schedule-toolbar">
              <button aria-label="이전 달" onClick={() => moveMonth(-1)} type="button">‹</button>
              <strong>{monthDate.year}년 {monthDate.monthIndex + 1}월</strong>
              <button aria-label="다음 달" onClick={() => moveMonth(1)} type="button">›</button>
            </div>

            <div className="coach-schedule-time-filters" role="group" aria-label="시간대 필터">
              {TIME_FILTERS.map((filter) => (
                <button
                  aria-pressed={timeFilter === filter.key}
                  className={timeFilter === filter.key ? "selected" : ""}
                  key={filter.key}
                  onClick={() => setTimeFilter(filter.key)}
                  type="button"
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <div className="coach-schedule-weekdays" aria-hidden="true">
              {["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="coach-schedule-grid">
              {buildCalendarCells(monthDate.year, monthDate.monthIndex).map((date, index) => {
                if (!date) return <span aria-hidden="true" className="coach-schedule-empty-day" key={`empty-${index}`} />;

                const count = monthCounts[date] ?? 0;
                const isSelected = date === selectedDate;
                const dateObject = new Date(`${date}T00:00:00`);
                const isWeekend = dateObject.getDay() === 0 || dateObject.getDay() === 6;

                return (
                  <button
                    aria-pressed={isSelected}
                    className={[
                      "coach-schedule-day",
                      isSelected ? "selected" : "",
                      isWeekend ? "weekend" : "",
                      count > 0 ? "has-coaches" : ""
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

            <div className="coach-schedule-calendar-meta">
              <span>가용일 {totalAvailableDays}일</span>
              <Link href="/coaches">코치 목록 보기</Link>
            </div>
          </section>

          <section className="dashboard-panel coach-schedule-list" aria-label="선택 날짜 가능 코치">
            <div className="section-title">
              <div>
                <h2>{selectedDate ? formatSelectedDate(selectedDate) : "날짜를 선택하세요"}</h2>
                <span>{timeFilterLabel(timeFilter)} 기준 가능 코치</span>
              </div>
              <div className="dashboard-table-meta">
                <span>{filteredCoaches.length}명</span>
              </div>
            </div>

            {loadFailed ? (
              <div className="empty-state coach-schedule-empty-state">
                <strong>코치 일정 데이터를 불러오지 못했습니다.</strong>
                <span>배포 DB 연결과 코치 import 상태를 확인하세요.</span>
              </div>
            ) : !selectedDate ? (
              <div className="empty-state coach-schedule-empty-state">
                <strong>조회할 날짜를 선택하세요.</strong>
                <span>달력에서 날짜를 누르면 해당 날짜에 가능한 코치가 표시됩니다.</span>
              </div>
            ) : filteredCoaches.length === 0 ? (
              <div className="empty-state coach-schedule-empty-state">
                <strong>조건에 맞는 가능 코치가 없습니다.</strong>
                <span>다른 날짜나 시간대를 선택하세요.</span>
              </div>
            ) : (
              <div className="coach-schedule-coach-list">
                {filteredCoaches.map((coach) => (
                  <Link className="coach-schedule-coach-row" href={`/coaches/${coach.id}`} key={coach.id}>
                    <div>
                      <strong>{coach.name}</strong>
                      <span>{coach.workType || "근무유형 없음"}</span>
                    </div>
                    <div className="coach-schedule-tags">
                      {coach.fields.length > 0 ? (
                        coach.fields.slice(0, 3).map((field) => <span key={field}>{field}</span>)
                      ) : (
                        <span>분야 없음</span>
                      )}
                    </div>
                    <div className="coach-schedule-row-meta">
                      <span>{formatScheduleLabel(coach.schedules)}</span>
                      <small>{latestEngagementLabel(coach)}</small>
                    </div>
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

function timeFilterLabel(filter: TimeFilterKey): string {
  return TIME_FILTERS.find((item) => item.key === filter)?.label ?? "전체";
}

function formatSelectedDate(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${value.getMonth() + 1}/${value.getDate()} (${weekdays[value.getDay()]})`;
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
