"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const ALL_SLOTS = Array.from({ length: 28 }, (_, index) => {
  const totalMinutes = 8 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

const BULK_RANGES = [
  { label: "오전", start: "08:00", end: "13:00" },
  { label: "오후", start: "13:00", end: "18:00" },
  { label: "저녁", start: "18:00", end: "22:00" },
  { label: "종일", start: "08:00", end: "22:00" }
] as const;

interface CoachInfo {
  id: string;
  name: string;
  status: string;
  workType: string | null;
  availabilityDetail: string | null;
  fields: Array<{ id: string; name: string }>;
  curriculums: Array<{ id: string; name: string }>;
}

interface ScheduleSlot {
  date: string;
  startTime: string;
  endTime: string;
}

interface EngagementScheduleEntry {
  date: string;
  startTime: string;
  endTime: string;
  courseName: string;
  status: string;
}

export function CoachPublicScheduleInput() {
  const token = useSearchParams().get("token");
  const today = new Date();
  const [yearMonth, setYearMonth] = useState(formatYearMonth(today));
  const [selectedDate, setSelectedDate] = useState(formatDate(today));
  const [coach, setCoach] = useState<CoachInfo | null>(null);
  const [slotKeys, setSlotKeys] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<EngagementScheduleEntry[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadData = useCallback(async () => {
    if (!token) {
      setError("유효한 접속 링크가 아닙니다.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const headers = { authorization: `Bearer ${token}` };
    const [meResponse, scheduleResponse] = await Promise.all([
      fetch(`/api/coach/me?token=${encodeURIComponent(token)}`, { headers }),
      fetch(`/api/coach/schedule/${yearMonth}`, { headers })
    ]);

    if (!meResponse.ok || !scheduleResponse.ok) {
      setError("코치 정보를 불러오지 못했습니다.");
      setLoading(false);
      return;
    }

    const meData = (await meResponse.json()) as { coach: CoachInfo };
    const scheduleData = (await scheduleResponse.json()) as {
      schedules: ScheduleSlot[];
      engagementSchedules: EngagementScheduleEntry[];
      lastSavedAt: string | null;
    };

    setCoach(meData.coach);
    setSlotKeys(schedulesToSlotKeys(scheduleData.schedules));
    setConfirmed(scheduleData.engagementSchedules);
    setLastSavedAt(scheduleData.lastSavedAt);
    setLoading(false);
  }, [token, yearMonth]);

  useEffect(() => {
    // Data fetching is the external synchronization this screen needs on token/month changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  const selectedSlots = useMemo(
    () => new Set([...slotKeys].filter((key) => key.startsWith(`${selectedDate}|`)).map((key) => key.split("|")[1])),
    [selectedDate, slotKeys]
  );
  const confirmedByDate = useMemo(() => new Set(confirmed.map((item) => item.date)), [confirmed]);
  const availableByDate = useMemo(() => {
    const dates = new Set<string>();
    for (const key of slotKeys) dates.add(key.split("|")[0]);
    return dates;
  }, [slotKeys]);
  const selectedConfirmed = confirmed.filter((item) => item.date === selectedDate);

  function toggleSlot(slot: string) {
    setSlotKeys((previous) => {
      const next = new Set(previous);
      const key = `${selectedDate}|${slot}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSaved(false);
  }

  function applyBulk(start: string, end: string) {
    setSlotKeys((previous) => {
      const next = new Set(previous);
      for (const slot of ALL_SLOTS) {
        if (slot >= start && slot < end) next.add(`${selectedDate}|${slot}`);
      }
      return next;
    });
    setSaved(false);
  }

  function clearDay() {
    setSlotKeys((previous) => {
      const next = new Set(previous);
      for (const key of previous) {
        if (key.startsWith(`${selectedDate}|`)) next.delete(key);
      }
      return next;
    });
    setSaved(false);
  }

  function goToMonth(offset: number) {
    const nextYearMonth = shiftMonth(yearMonth, offset);
    setYearMonth(nextYearMonth);
    setSelectedDate(`${nextYearMonth}-01`);
  }

  async function save() {
    if (!token) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/coach/schedule/${yearMonth}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ schedules: slotKeysToSchedules(slotKeys) })
    });

    setSaving(false);
    if (!response.ok) {
      setError("저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    setSaved(true);
    setLastSavedAt(new Date().toISOString());
    await loadData();
  }

  if (loading) {
    return <main className="coach-public-shell"><p>불러오는 중...</p></main>;
  }

  if (error && !coach) {
    return <main className="coach-public-shell"><p>{error}</p></main>;
  }

  return (
    <main className="coach-public-shell">
      <section className="coach-public-page">
        <header className="coach-public-header">
          <div>
            <p className="coach-public-kicker">코치 일정 입력</p>
            <h1>{coach?.name}</h1>
            <div className="coach-public-tags">
              {splitWorkTypes(coach?.workType ?? null).map((item) => <span key={item}>{item}</span>)}
              {coach?.fields.slice(0, 4).map((field) => <span key={field.id}>{field.name}</span>)}
            </div>
          </div>
          <button disabled={saving} onClick={save} type="button">{saving ? "저장 중" : saved ? "저장됨" : "저장"}</button>
        </header>

        <section className="coach-public-layout">
          <section className="coach-public-calendar-card">
            <div className="coach-public-month-nav">
              <button onClick={() => goToMonth(-1)} type="button">‹</button>
              <strong>{formatMonthLabel(yearMonth)}</strong>
              <button onClick={() => goToMonth(1)} type="button">›</button>
            </div>

            <div className="coach-public-weekdays">
              {["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}
            </div>

            <div className="coach-public-calendar-grid">
              {calendarCells(yearMonth).map((date, index) => {
                if (!date) return <span aria-hidden="true" key={`empty-${index}`} />;
                const day = Number(date.slice(-2));
                const className = [
                  "coach-public-day",
                  date === selectedDate ? "selected" : "",
                  availableByDate.has(date) ? "available" : "",
                  confirmedByDate.has(date) ? "confirmed" : ""
                ].filter(Boolean).join(" ");
                return (
                  <button className={className} key={date} onClick={() => setSelectedDate(date)} type="button">
                    {day}
                  </button>
                );
              })}
            </div>

            <div className="coach-public-legend">
              <span><i className="available" />가능</span>
              <span><i className="confirmed" />확정</span>
              <span><i />선택</span>
            </div>
          </section>

          <section className="coach-public-time-card">
            <div className="coach-public-section-title">
              <strong>{formatDateLabel(selectedDate)}</strong>
              <button onClick={clearDay} type="button">비우기</button>
            </div>

            <div className="coach-public-bulk">
              {BULK_RANGES.map((range) => (
                <button key={range.label} onClick={() => applyBulk(range.start, range.end)} type="button">
                  {range.label}
                </button>
              ))}
            </div>

            <div className="coach-public-time-grid">
              {ALL_SLOTS.map((slot) => (
                <button
                  className={selectedSlots.has(slot) ? "selected" : ""}
                  key={slot}
                  onClick={() => toggleSlot(slot)}
                  type="button"
                >
                  {slot}
                </button>
              ))}
            </div>

            <div className="coach-public-confirmed">
              <strong>확정 일정</strong>
              {selectedConfirmed.length > 0 ? (
                selectedConfirmed.map((item) => (
                  <p key={`${item.date}-${item.startTime}-${item.courseName}`}>
                    {item.startTime}~{item.endTime} {cleanCourseName(item.courseName)}
                  </p>
                ))
              ) : (
                <p>확정된 일정이 없습니다.</p>
              )}
            </div>
          </section>
        </section>

        <footer className="coach-public-footer">
          <span>{lastSavedAt ? `마지막 저장 ${formatDateTime(lastSavedAt)}` : "아직 저장된 일정이 없습니다."}</span>
          {error ? <strong>{error}</strong> : null}
        </footer>
      </section>
    </main>
  );
}

function schedulesToSlotKeys(schedules: ScheduleSlot[]): Set<string> {
  const keys = new Set<string>();
  for (const schedule of schedules) {
    const startIndex = ALL_SLOTS.indexOf(schedule.startTime);
    const endIndex = ALL_SLOTS.indexOf(schedule.endTime);
    const lastIndex = endIndex === -1 ? ALL_SLOTS.length : endIndex;
    if (startIndex === -1) continue;
    for (let index = startIndex; index < lastIndex; index += 1) {
      keys.add(`${schedule.date}|${ALL_SLOTS[index]}`);
    }
  }
  return keys;
}

function slotKeysToSchedules(keys: Set<string>): ScheduleSlot[] {
  const byDate = new Map<string, string[]>();
  for (const key of keys) {
    const [date, slot] = key.split("|");
    byDate.set(date, [...(byDate.get(date) ?? []), slot]);
  }

  const schedules: ScheduleSlot[] = [];
  for (const [date, slots] of byDate) {
    const sorted = Array.from(new Set(slots)).sort();
    let start = sorted[0];
    let previous = sorted[0];
    for (let index = 1; index < sorted.length; index += 1) {
      if (ALL_SLOTS.indexOf(sorted[index]) === ALL_SLOTS.indexOf(previous) + 1) {
        previous = sorted[index];
        continue;
      }
      schedules.push({ date, startTime: start, endTime: endOfSlot(previous) });
      start = sorted[index];
      previous = sorted[index];
    }
    if (start) schedules.push({ date, startTime: start, endTime: endOfSlot(previous) });
  }

  return schedules.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

function endOfSlot(slot: string): string {
  const [hour, minute] = slot.split(":").map(Number);
  const date = new Date(2026, 0, 1, hour, minute + 30);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function calendarCells(yearMonth: string): Array<string | null> {
  const [year, month] = yearMonth.split("-").map(Number);
  const first = new Date(year, month - 1, 1).getDay();
  const lastDate = new Date(year, month, 0).getDate();
  const cells: Array<string | null> = [];
  for (let index = 0; index < first; index += 1) cells.push(null);
  for (let day = 1; day <= lastDate; day += 1) {
    cells.push(`${yearMonth}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length < 42) cells.push(null);
  return cells;
}

function shiftMonth(yearMonth: string, offset: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return formatYearMonth(date);
}

function formatYearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(date: Date): string {
  return `${formatYearMonth(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return `${year}년 ${month}월`;
}

function formatDateLabel(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function splitWorkTypes(value: string | null): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function cleanCourseName(value: string): string {
  return value
    .replace(/\[부가세\s*별도\]\s*/g, "")
    .replace(/\(B2B\)\s*/g, "")
    .replace(/_/g, " ")
    .trim() || value;
}
