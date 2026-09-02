"use client";

import { useState } from "react";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

interface MultiDateCalendarProps {
  value: string[];
  onChange: (dates: string[]) => void;
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 여러 날짜를 직접 클릭해 고르는 달력. 숙소 예약 사이트의 날짜 선택기처럼, 연속되지 않는
 * 날짜(예: 9/3, 9/4, 9/7)도 시작일~종료일 텍스트 입력 없이 그대로 고를 수 있게 한다. */
export function MultiDateCalendar({ value, onChange }: MultiDateCalendarProps) {
  const selected = new Set(value);
  const initial = value.length > 0 ? new Date(`${[...value].sort()[0]}T00:00:00`) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ];
  const sortedSelected = [...selected].sort();

  return (
    <div className="multi-date-calendar">
      <div className="multi-date-calendar-header">
        <button aria-label="이전 달" onClick={() => changeMonth(-1)} type="button">
          ‹
        </button>
        <span>
          {viewYear}년 {viewMonth + 1}월
        </span>
        <button aria-label="다음 달" onClick={() => changeMonth(1)} type="button">
          ›
        </button>
      </div>
      <div className="multi-date-calendar-weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="multi-date-calendar-grid">
        {cells.map((day, index) => {
          if (day === null) return <span className="multi-date-calendar-cell empty" key={`empty-${index}`} />;

          const iso = toIsoDate(viewYear, viewMonth, day);
          const weekday = (firstWeekday + day - 1) % 7;

          return (
            <button
              className={`multi-date-calendar-cell${selected.has(iso) ? " selected" : ""}${
                weekday === 0 || weekday === 6 ? " weekend" : ""
              }`}
              key={iso}
              onClick={() => toggleDate(iso)}
              type="button"
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="multi-date-calendar-summary">
        {sortedSelected.length > 0 ? `${sortedSelected.length}일 선택됨 · ${sortedSelected.join(", ")}` : "날짜를 선택하세요"}
      </div>
    </div>
  );

  function toggleDate(iso: string) {
    const next = new Set(selected);
    if (next.has(iso)) next.delete(iso);
    else next.add(iso);
    onChange(Array.from(next).sort());
  }

  function changeMonth(delta: number) {
    let month = viewMonth + delta;
    let year = viewYear;
    if (month < 0) {
      month = 11;
      year -= 1;
    } else if (month > 11) {
      month = 0;
      year += 1;
    }
    setViewMonth(month);
    setViewYear(year);
  }
}
