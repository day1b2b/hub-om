"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

interface MultiDateCalendarProps {
  value: string[];
  onChange: (dates: string[]) => void;
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 여러 날짜를 직접 클릭해 고르는 달력. 숙소 예약 사이트의 날짜 선택기처럼, 연속되지 않는
 * 날짜(예: 9/3, 9/4, 9/7)도 시작일~종료일 텍스트 입력 없이 그대로 고를 수 있게 한다.
 * 클릭 토글 외에 마우스 드래그로도 여러 날짜를 한 번에 선택/해제할 수 있다. */
export function MultiDateCalendar({ value, onChange }: MultiDateCalendarProps) {
  const selected = new Set(value);
  const initial = value.length > 0 ? new Date(`${[...value].sort()[0]}T00:00:00`) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [isDragging, setIsDragging] = useState(false);

  // 드래그 중에는 마우스 이벤트가 리렌더보다 빠르게 연달아 들어올 수 있어, props(value)가
  // 아직 갱신되지 않은 시점에도 정확한 현재 선택 상태를 참조하기 위해 ref로 따로 들고 있는다.
  const workingSetRef = useRef(new Set(value));
  const dragModeRef = useRef<"add" | "remove">("add");
  const isPressedRef = useRef(false);
  const draggedRef = useRef(false);
  const startIsoRef = useRef<string | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    workingSetRef.current = new Set(value);
  }, [value]);

  const applyCell = useCallback(
    (iso: string) => {
      const next = workingSetRef.current;
      const shouldSelect = dragModeRef.current === "add";
      if (next.has(iso) === shouldSelect) return;
      if (shouldSelect) next.add(iso);
      else next.delete(iso);
      onChange(Array.from(next).sort());
    },
    [onChange]
  );

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseUp() {
      // draggedRef는 여기서 끄지 않는다 - mouseup 바로 뒤에 오는 native click 이벤트가
      // "드래그였는지"를 판단해야 하기 때문(아래 click 캡처 리스너 참고).
      isPressedRef.current = false;
      setIsDragging(false);
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  useEffect(() => {
    const DRAG_THRESHOLD_PX = 4;
    // 시작 칸에서 바로 위 "이전/다음 달" 버튼처럼, 다른 날짜 칸을 거치지 않고 달력 영역
    // 밖으로 빠져나가는 드래그도 있다. onMouseEnter만으로는 이런 경로를 드래그로 인식하지
    // 못하므로, 눌린 채로 일정 거리 이상 움직이면 어디로 움직였든 드래그로 판정한다.
    function handleMouseMove(event: MouseEvent) {
      if (!isPressedRef.current || draggedRef.current) return;
      const start = startPointRef.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      draggedRef.current = true;
      if (startIsoRef.current) applyCell(startIsoRef.current);
    }
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [applyCell]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 드래그로 날짜를 선택한 뒤 마우스를 뗀 지점이 달력 헤더의 "이전/다음 달" 버튼 위일 수
    // 있다. click 이벤트는 mousedown 위치가 아니라 mouseup(=뗀) 위치의 요소를 대상으로
    // 발생하므로, 그대로 두면 드래그를 끝내자마자 의도치 않게 월이 넘어간다. 캡처 단계에서
    // 미리 가로채 드래그 뒤에 따라오는 click을 완전히 무효화한다.
    function suppressClickAfterDrag(event: MouseEvent) {
      if (!draggedRef.current) return;
      event.stopPropagation();
      event.preventDefault();
      draggedRef.current = false;
    }
    container.addEventListener("click", suppressClickAfterDrag, true);
    return () => container.removeEventListener("click", suppressClickAfterDrag, true);
  }, []);

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ];
  const sortedSelected = [...selected].sort();

  return (
    <div className="multi-date-calendar" ref={containerRef}>
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
      <div className={`multi-date-calendar-grid${isDragging ? " dragging" : ""}`}>
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
              onClick={() => {
                if (!draggedRef.current) applyCell(iso);
                isPressedRef.current = false;
                draggedRef.current = false;
                setIsDragging(false);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                isPressedRef.current = true;
                draggedRef.current = false;
                startIsoRef.current = iso;
                startPointRef.current = { x: event.clientX, y: event.clientY };
                dragModeRef.current = workingSetRef.current.has(iso) ? "remove" : "add";
                setIsDragging(true);
              }}
              onMouseEnter={() => {
                if (!isPressedRef.current) return;
                applyCell(iso);
              }}
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
