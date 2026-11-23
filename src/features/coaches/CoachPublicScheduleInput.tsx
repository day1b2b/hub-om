"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ALL_SLOTS = Array.from({ length: 28 }, (_, index) => {
  const totalMinutes = 8 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

// 시간은 개별 칸 대신 시간대 프리셋으로만 고른다(종일·오전·오후·저녁). 저장은 30분 슬롯 그대로라 백엔드는 안 바뀐다.
const PERIODS = [
  { key: "all", label: "종일", start: "08:00", end: "22:00" },
  { key: "morning", label: "오전", start: "08:00", end: "12:00" },
  { key: "afternoon", label: "오후", start: "12:00", end: "18:00" },
  { key: "evening", label: "저녁", start: "18:00", end: "22:00" }
] as const;

type Period = (typeof PERIODS)[number];

function slotsInRange(start: string, end: string): string[] {
  return ALL_SLOTS.filter((slot) => slot >= start && slot < end);
}

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
  // 토큰은 주소창에 남기지 않는다(코치에게 지저분하고 referrer·로그에도 노출됨). 첫 진입 때 URL에서 받아
  // 세션 저장에 옮기고 주소창에서 지운다. 이후 요청은 Authorization 헤더로만 보낸다(쿼리 토큰 없음).
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  // 드래그 시작점(anchor) + 드래그 전 선택 스냅샷 + 모드. 시작 칸 상태로 범위를 선택(add)·해제(remove)한다.
  const dragAnchor = useRef<{ date: string; base: Set<string>; moved: boolean; mode: "add" | "remove" } | null>(null);
  const today = new Date();
  const todayStr = formatDate(today);
  const [yearMonth, setYearMonth] = useState(formatYearMonth(today));
  // 가용 입력 대상으로 고른 날짜들(여러 날 동시 선택). 시간대 프리셋은 이 날짜들에 한꺼번에 적용한다.
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [coach, setCoach] = useState<CoachInfo | null>(null);
  const [slotKeys, setSlotKeys] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<EngagementScheduleEntry[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  // 저장 목록에 보일 날짜들(로드·저장 시점 기준). 동그라미를 다 꺼도 저장 전까지는 줄을 남겨 둔다.
  const [savedDates, setSavedDates] = useState<string[]>([]);
  // 저장 목록에서 체크한 날짜들(선택 삭제용).
  const [checkedDates, setCheckedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    // 주소창 토큰·세션 저장이라는 외부 시스템과 마운트 때 1회 동기화한다.
    // 세션 저장을 못 쓰는 환경(사생활 보호 모드 등)에선 토큰을 지우지 않아 새로고침해도 링크가 살아 있게 둔다.
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("token")?.trim() || null;
    let resolved: string | null = null;
    if (fromUrl) {
      resolved = fromUrl;
      let stored = false;
      try {
        sessionStorage.setItem("coachAccessToken", fromUrl);
        stored = true;
      } catch {
        stored = false;
      }
      if (stored) {
        url.searchParams.delete("token");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } else {
      try {
        resolved = sessionStorage.getItem("coachAccessToken");
      } catch {
        resolved = null;
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(resolved);
    setTokenReady(true);
  }, []);

  useEffect(() => {
    const finishDrag = () => {
      const anchor = dragAnchor.current;
      dragAnchor.current = null;
      // 움직이지 않고 떼면 '탭' = 그 날 하나만 토글(선택/해제). 드래그였으면 이미 범위가 반영돼 있다.
      if (anchor && !anchor.moved) {
        setSelectedDates((previous) => {
          const next = new Set(previous);
          if (next.has(anchor.date)) next.delete(anchor.date);
          else next.add(anchor.date);
          return next;
        });
      }
    };
    const cancelDrag = () => {
      dragAnchor.current = null;
    };
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", cancelDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!tokenReady) return;
    if (!token) {
      setError("유효한 접속 링크가 아닙니다.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const headers = { authorization: `Bearer ${token}` };
    const [meResponse, scheduleResponse] = await Promise.all([
      fetch(`/api/coach/me`, { headers }),
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
    setSavedDates([...new Set(scheduleData.schedules.map((item) => item.date))].sort());
    setCheckedDates(new Set());
    setConfirmed(scheduleData.engagementSchedules);
    setLastSavedAt(scheduleData.lastSavedAt);
    setSelectedDates(new Set());
    setDirty(false);
    setLoading(false);
  }, [token, yearMonth, tokenReady]);

  useEffect(() => {
    // Data fetching is the external synchronization this screen needs on token/month changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const monthBounds = useMemo(() => {
    const [year, month] = yearMonth.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return { start: `${yearMonth}-01`, end: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
  }, [yearMonth]);

  const confirmedByDate = useMemo(() => new Set(confirmed.map((item) => item.date)), [confirmed]);
  // 확정일은 '날짜 통째 제외' — 가용 표시/입력 모델에서 빼, 달력·하단 목록 어디서도 가용을 넣거나 고칠 수 없게 한다.
  // (기존에 넣어둔 slotKeys는 지우지 않아 저장 시 보존되고, 투입이 취소돼 확정이 풀리면 다시 보인다.)
  const availableByDate = useMemo(() => {
    const dates = new Set<string>();
    for (const key of slotKeys) {
      const date = key.split("|")[0];
      if (!confirmedByDate.has(date)) dates.add(date);
    }
    return dates;
  }, [slotKeys, confirmedByDate]);

  // 확정일 칸에 보여 줄 과정명(짧게 자름). 같은 날 2건 이상이면 "첫 과정 +N", 툴팁엔 전체.
  const confirmedCourseByDate = useMemo(() => {
    const namesByDate = new Map<string, string[]>();
    for (const item of confirmed) {
      const name = cleanCourseName(item.courseName).trim();
      if (!name) continue; // 빈 과정명은 제외(빈 span·앞공백 툴팁 방지)
      const list = namesByDate.get(item.date) ?? [];
      if (!list.includes(name)) list.push(name);
      namesByDate.set(item.date, list);
    }
    const result = new Map<string, { label: string; title: string }>();
    for (const [date, names] of namesByDate) {
      result.set(date, {
        label: names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0],
        title: names.join(", ")
      });
    }
    return result;
  }, [confirmed]);

  // 내 확정 일정: 오늘 이후만, 과정별로 묶어 기간·시간으로 보여 준다(지난 건 숨김).
  const upcomingConfirmed = useMemo(() => {
    const groups = new Map<string, { name: string; dates: string[]; times: Set<string> }>();
    for (const item of confirmed) {
      if (item.date < todayStr) continue;
      const name = cleanCourseName(item.courseName);
      const group = groups.get(name) ?? { name, dates: [], times: new Set<string>() };
      group.dates.push(item.date);
      group.times.add(`${item.startTime}~${item.endTime}`);
      groups.set(name, group);
    }
    return [...groups.values()]
      .map((group) => {
        const sorted = [...group.dates].sort();
        return { name: group.name, start: sorted[0], end: sorted[sorted.length - 1], time: [...group.times].sort().join(", ") };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [confirmed, todayStr]);

  // 시간대 버튼 표시: 오전·오후·저녁은 고른 날짜 중 하나라도 그 시간대 슬롯이 있으면 '선택됨'으로 본다(세부는 버린다).
  // 종일은 "하루 전체가 꽉 찬" 날이 있을 때만 켜서, 일부만 있는데 종일까지 켜진 것처럼 보이지 않게 한다.
  const periodActive = useMemo(() => {
    const dates = [...selectedDates];
    const state: Record<string, boolean> = {};
    for (const period of PERIODS) {
      const slots = slotsInRange(period.start, period.end);
      state[period.key] = period.key === "all"
        ? dates.some((date) => slots.every((slot) => slotKeys.has(`${date}|${slot}`)))
        : dates.some((date) => slots.some((slot) => slotKeys.has(`${date}|${slot}`)));
    }
    return state;
  }, [selectedDates, slotKeys]);

  // 코치가 저장(입력)한 가능 일정을 날짜순으로, 시간대 동그라미(오전/오후/저녁/종일)로 보여 준다.
  // 동그라미를 다 꺼 슬롯이 0이어도 저장 전까진 줄을 유지(savedDates와 합집합).
  const availabilitySummary = useMemo(() => {
    const byDate = new Map<string, Set<string>>();
    for (const key of slotKeys) {
      const [date, slot] = key.split("|");
      const set = byDate.get(date) ?? new Set<string>();
      set.add(slot);
      byDate.set(date, set);
    }
    const dates = new Set<string>([...byDate.keys(), ...savedDates]);
    return [...dates]
      .filter((date) => !confirmedByDate.has(date)) // 확정일은 가용 목록에서 제외(잠금 — 하단에서도 못 고침)
      .sort()
      .map((date) => {
        const slots = byDate.get(date) ?? new Set<string>();
        const morning = slotsInRange("08:00", "12:00").some((slot) => slots.has(slot));
        const afternoon = slotsInRange("12:00", "18:00").some((slot) => slots.has(slot));
        const evening = slotsInRange("18:00", "22:00").some((slot) => slots.has(slot));
        return { date, morning, afternoon, evening, allDay: morning && afternoon && evening };
      });
  }, [slotKeys, savedDates, confirmedByDate]);

  function toggleDate(date: string) {
    if (confirmedByDate.has(date)) return; // 확정일은 잠금(선택 불가)
    setSelectedDates((previous) => {
      const next = new Set(previous);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function clearSelection() {
    setSelectedDates(new Set());
  }

  // 날짜 선택/해제: 한 날을 눌렀다 이동 없이 떼면 그 날 하나 토글(위 finishDrag). 누른 채 다른 날로 쓸면(드래그)
  // 지나간 경로가 아니라 시작~현재의 '연속 날짜 범위'를 계산한다. 시작 칸이 이미 선택돼 있으면 그 범위를
  // 해제, 비어 있으면 선택(앵커 기준 모드) — 선택도 드래그, 취소도 드래그.
  function startDateDrag(date: string) {
    if (confirmedByDate.has(date)) return; // 확정일에선 드래그 시작 안 함(잠금)
    dragAnchor.current = { date, base: new Set(selectedDates), moved: false, mode: selectedDates.has(date) ? "remove" : "add" };
  }

  function extendDrag(clientX: number, clientY: number) {
    const anchor = dragAnchor.current;
    if (!anchor) return;
    const target = document.elementFromPoint(clientX, clientY);
    const date = target instanceof HTMLElement ? target.dataset.date : undefined;
    if (!date || date === anchor.date) return;
    anchor.moved = true;
    const range = datesBetween(anchor.date, date).filter((rangeDate) => !confirmedByDate.has(rangeDate)); // 확정일은 범위에서 제외
    if (anchor.mode === "add") {
      setSelectedDates(new Set([...anchor.base, ...range]));
    } else {
      const next = new Set(anchor.base);
      for (const removed of range) next.delete(removed);
      setSelectedDates(next);
    }
  }

  // 기간 입력(시작~종료) → 그 구간 날짜를 선택에 더한다. 저장은 월 단위라 지금 보는 달 안으로 잘라 넣는다.
  function selectRange() {
    let start = rangeStart || monthBounds.start;
    let end = rangeEnd || monthBounds.end;
    if (start > end) [start, end] = [end, start];
    if (start < monthBounds.start) start = monthBounds.start;
    if (end > monthBounds.end) end = monthBounds.end;
    if (start > monthBounds.end || end < monthBounds.start) return;
    const dates: string[] = [];
    const cursor = new Date(`${start}T00:00:00`);
    const stop = new Date(`${end}T00:00:00`);
    while (cursor <= stop) {
      dates.push(formatDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    setSelectedDates((previous) => {
      const next = new Set(previous);
      for (const date of dates) if (!confirmedByDate.has(date)) next.add(date); // 확정일 제외
      return next;
    });
  }

  // 고른 날짜들에 시간대를 한꺼번에 적용. 모두 이미 그 시간대로 꽉 차 있으면 지우고, 아니면 채운다(토글).
  function applyPeriod(period: Period) {
    const dates = [...selectedDates];
    if (dates.length === 0) return;
    const slots = slotsInRange(period.start, period.end);
    const allFilled = dates.every((date) => slots.every((slot) => slotKeys.has(`${date}|${slot}`)));
    setSlotKeys((previous) => {
      const next = new Set(previous);
      for (const date of dates) {
        for (const slot of slots) {
          const key = `${date}|${slot}`;
          if (allFilled) next.delete(key);
          else next.add(key);
        }
      }
      return next;
    });
    setSaved(false);
    setDirty(true);
  }

  function clearSelectedDates() {
    if (selectedDates.size === 0) return;
    setSlotKeys((previous) => {
      const next = new Set<string>();
      for (const key of previous) {
        if (!selectedDates.has(key.split("|")[0])) next.add(key);
      }
      return next;
    });
    setSaved(false);
    setDirty(true);
  }

  // 저장 목록 동그라미: 그 날짜의 한 시간대를 통째로 켜고 끈다(세부 슬롯은 시간대 기준으로 정리). 종일=오전·오후·저녁 일괄.
  function togglePeriodForDate(date: string, key: string) {
    setSlotKeys((previous) => {
      const next = new Set(previous);
      const has = (slot: string) => previous.has(`${date}|${slot}`);
      if (key === "all") {
        const base = PERIODS.filter((period) => period.key !== "all");
        const allOn = base.every((period) => slotsInRange(period.start, period.end).some(has));
        for (const slot of ALL_SLOTS) {
          const slotKey = `${date}|${slot}`;
          if (allOn) next.delete(slotKey);
          else next.add(slotKey);
        }
      } else {
        const period = PERIODS.find((item) => item.key === key);
        if (!period) return next;
        const slots = slotsInRange(period.start, period.end);
        const on = slots.some(has);
        for (const slot of slots) {
          const slotKey = `${date}|${slot}`;
          if (on) next.delete(slotKey);
          else next.add(slotKey);
        }
      }
      return next;
    });
    setSaved(false);
    setDirty(true);
  }

  // 저장 목록에서 한 날짜를 통째로 지운다(슬롯·표시줄 모두 제거). 저장은 사용자가 저장바로.
  function removeAvailabilityDate(date: string) {
    setSlotKeys((previous) => {
      const next = new Set<string>();
      for (const key of previous) {
        if (key.split("|")[0] !== date) next.add(key);
      }
      return next;
    });
    setSavedDates((previous) => previous.filter((item) => item !== date));
    setCheckedDates((previous) => {
      const next = new Set(previous);
      next.delete(date);
      return next;
    });
    setSaved(false);
    setDirty(true);
  }

  // 체크한 날짜들을 한꺼번에 지운다(선택 삭제).
  function removeCheckedDates() {
    if (checkedDates.size === 0) return;
    setSlotKeys((previous) => {
      const next = new Set<string>();
      for (const key of previous) {
        if (!checkedDates.has(key.split("|")[0])) next.add(key);
      }
      return next;
    });
    setSavedDates((previous) => previous.filter((item) => !checkedDates.has(item)));
    setCheckedDates(new Set());
    setSaved(false);
    setDirty(true);
  }

  function toggleCheckedDate(date: string) {
    setCheckedDates((previous) => {
      const next = new Set(previous);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function toggleAllChecked(dates: string[], checked: boolean) {
    setCheckedDates(checked ? new Set(dates) : new Set());
  }

  function goToMonth(offset: number) {
    if (dirty && !window.confirm("저장하지 않은 일정이 있어요. 저장하지 않고 이동할까요?")) return;
    const nextYearMonth = shiftMonth(yearMonth, offset);
    setYearMonth(nextYearMonth);
    setSelectedDates(new Set());
    setRangeStart("");
    setRangeEnd("");
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
            <p className="coach-public-kicker">코치 일정</p>
            <h1>{coach?.name}</h1>
            <div className="coach-public-tags">
              {splitWorkTypes(coach?.workType ?? null).map((item) => <span key={item}>{item}</span>)}
              {coach?.fields.slice(0, 4).map((field) => <span key={field.id}>{field.name}</span>)}
            </div>
          </div>
          <div className="coach-public-save">
            <button className={dirty ? "dirty" : ""} disabled={saving} onClick={save} type="button">
              {saving ? "저장 중" : dirty ? "저장하기" : saved ? "저장됨" : "저장"}
            </button>
            {dirty && !saving ? <span>저장 전 변경 있음</span> : null}
          </div>
        </header>

        <section className="coach-public-confirmed-top">
          <div className="coach-public-confirmed-head">
            <strong>내 확정 일정</strong>
            <span>다가오는 근무</span>
          </div>
          {upcomingConfirmed.length > 0 ? (
            <ul className="coach-public-confirmed-list">
              {upcomingConfirmed.map((item) => (
                <li key={`${item.name}-${item.start}`}>
                  <b>{item.name}</b>
                  <span>{formatRange(item.start, item.end)} · {item.time}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="coach-public-confirmed-empty">다가오는 확정 일정이 없어요.</p>
          )}
        </section>

        <p className="coach-public-guide">
          비는 날을 고르고 시간대를 눌러 주세요 :)<br />
          날짜는 눌러서, 또는 쓸어서 여러 날을 한 번에 고를 수 있어요.
        </p>

        <section className="coach-public-layout">
          <section className="coach-public-calendar-card">
            <div className="coach-public-month-nav">
              <button aria-label="이전 달" onClick={() => goToMonth(-1)} type="button">‹</button>
              <strong>{formatMonthLabel(yearMonth)}</strong>
              <button aria-label="다음 달" onClick={() => goToMonth(1)} type="button">›</button>
            </div>

            <div className="coach-public-weekdays">
              {["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}
            </div>

            <div
              className="coach-public-calendar-grid"
              onPointerMove={(event) => extendDrag(event.clientX, event.clientY)}
              style={{ touchAction: "none", userSelect: "none" }}
            >
              {calendarCells(yearMonth).map((date, index) => {
                if (!date) return <span aria-hidden="true" key={`empty-${index}`} />;
                const day = Number(date.slice(-2));
                const locked = confirmedByDate.has(date);
                const course = confirmedCourseByDate.get(date);
                const className = [
                  "coach-public-day",
                  selectedDates.has(date) ? "selected" : "",
                  availableByDate.has(date) ? "available" : "",
                  locked ? "confirmed" : ""
                ].filter(Boolean).join(" ");
                return (
                  <button
                    aria-disabled={locked || undefined}
                    aria-label={locked ? `${day}일 확정${course ? `: ${course.title}` : ""} · 선택 불가` : undefined}
                    className={className}
                    data-date={date}
                    key={date}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleDate(date);
                      }
                    }}
                    onPointerDown={() => startDateDrag(date)}
                    title={locked && course ? `${course.title} · 확정 · 선택 불가` : undefined}
                    type="button"
                  >
                    {locked ? (
                      <span className="coach-public-day-confirmed">
                        <span className="coach-public-day-top">
                          <span>{day}</span>
                          <span aria-hidden="true">🔒</span>
                        </span>
                        {course ? <span className="coach-public-day-course">{course.label}</span> : null}
                      </span>
                    ) : (
                      day
                    )}
                  </button>
                );
              })}
            </div>

            <div className="coach-public-legend">
              <span><i className="available" />가능</span>
              <span><i className="confirmed" />확정</span>
              <span><i className="selected" />선택</span>
            </div>

            {selectedDates.size > 0 ? (
              <button className="coach-public-calendar-reset" onClick={clearSelection} type="button">
                선택 초기화 ({selectedDates.size}일)
              </button>
            ) : null}
          </section>

          <section className="coach-public-time-card">
            <div className="coach-public-section-title">
              <strong>가능한 날 알려주기</strong>
            </div>

            <div className="coach-public-range">
              <input aria-label="시작일" max={monthBounds.end} min={monthBounds.start} onChange={(event) => setRangeStart(event.target.value)} type="date" value={rangeStart} />
              <span>~</span>
              <input aria-label="종료일" max={monthBounds.end} min={monthBounds.start} onChange={(event) => setRangeEnd(event.target.value)} type="date" value={rangeEnd} />
              <button onClick={selectRange} type="button">이 기간 선택</button>
            </div>

            <div className="coach-public-selected-note">
              {selectedDates.size > 0 ? (
                <>
                  <span>선택한 날 <b>{selectedDates.size}일</b> 에 시간대를 적용하세요</span>
                  <button onClick={clearSelection} type="button">선택 해제</button>
                </>
              ) : (
                <span>달력에서 날짜를 고르면 시간대를 넣을 수 있어요</span>
              )}
            </div>

            {selectedDates.size > 0 ? (
              <div className="coach-public-selected-chips">
                {[...selectedDates].sort().map((date) => <span key={date}>{formatShortDate(date)}</span>)}
              </div>
            ) : null}

            <div className="coach-public-periods">
              {PERIODS.map((period) => (
                <button
                  className={periodActive[period.key] ? "selected" : ""}
                  disabled={selectedDates.size === 0}
                  key={period.key}
                  onClick={() => applyPeriod(period)}
                  type="button"
                >
                  {period.label}
                </button>
              ))}
            </div>

            <div className="coach-public-periods-foot">
              <span>오전 08–12 · 오후 12–18 · 저녁 18–22</span>
              <button disabled={selectedDates.size === 0} onClick={clearSelectedDates} type="button">비우기</button>
            </div>
          </section>
        </section>

        <section className="coach-public-saved">
          <div className="coach-public-saved-head">
            <strong>내가 넣은 가능 일정</strong>
            <span>{formatMonthLabel(yearMonth)}</span>
          </div>
          {availabilitySummary.length > 0 ? (
            <>
              <div className="coach-public-saved-toolbar">
                <label className="coach-public-saved-selall">
                  <input
                    checked={checkedDates.size > 0 && checkedDates.size === availabilitySummary.length}
                    onChange={(event) => toggleAllChecked(availabilitySummary.map((item) => item.date), event.target.checked)}
                    ref={(node) => {
                      if (node) node.indeterminate = checkedDates.size > 0 && checkedDates.size < availabilitySummary.length;
                    }}
                    type="checkbox"
                  />
                  전체 선택
                </label>
                <button
                  className="coach-public-saved-bulk"
                  disabled={checkedDates.size === 0}
                  onClick={removeCheckedDates}
                  type="button"
                >
                  선택 삭제{checkedDates.size > 0 ? ` (${checkedDates.size})` : ""}
                </button>
              </div>
              <ul className="coach-public-saved-list">
                {availabilitySummary.map((item) => (
                  <li className={checkedDates.has(item.date) ? "checked" : ""} key={item.date}>
                    <input
                      aria-label={`${formatDateLabel(item.date)} 선택`}
                      checked={checkedDates.has(item.date)}
                      className="coach-public-saved-check"
                      onChange={() => toggleCheckedDate(item.date)}
                      type="checkbox"
                    />
                    <b>{formatDateLabel(item.date)}</b>
                    <div className="coach-public-saved-periods">
                      {[
                        { key: "morning", label: "오전", on: item.morning },
                        { key: "afternoon", label: "오후", on: item.afternoon },
                        { key: "evening", label: "저녁", on: item.evening },
                        { key: "all", label: "종일", on: item.allDay }
                      ].map((period) => (
                        <button
                          aria-label={`${formatDateLabel(item.date)} ${period.label} ${period.on ? "켜짐" : "꺼짐"}`}
                          aria-pressed={period.on}
                          className={`coach-public-dot${period.key === "all" ? " allday" : ""}${period.on ? " on" : ""}`}
                          key={period.key}
                          onClick={() => togglePeriodForDate(item.date, period.key)}
                          type="button"
                        >
                          {period.label}
                        </button>
                      ))}
                    </div>
                    <button
                      aria-label={`${formatDateLabel(item.date)} 삭제`}
                      className="coach-public-saved-remove"
                      onClick={() => removeAvailabilityDate(item.date)}
                      type="button"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <p className="coach-public-saved-hint">동그라미를 눌러 시간대를 바꿀 수 있어요. 다 끄고 저장하면 그 날짜는 일정에서 빠져요.</p>
            </>
          ) : (
            <p className="coach-public-saved-empty">아직 넣은 가능 일정이 없어요. 위 달력에서 날짜를 고르고 시간대를 눌러 주세요 :)</p>
          )}
        </section>

        {dirty ? (
          <div className="coach-public-savebar">
            <button disabled={saving} onClick={save} type="button">
              {saving ? "저장 중..." : "저장하기"}
            </button>
          </div>
        ) : null}

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

function formatShortDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

// 두 날짜 사이의 연속 날짜 전부(시작·끝 포함). 같은 달 안에서만 쓴다(저장이 월 단위라).
function datesBetween(a: string, b: string): string[] {
  const [start, end] = a <= b ? [a, b] : [b, a];
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const stop = new Date(`${end}T00:00:00`);
  while (cursor <= stop) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function formatRange(start: string, end: string): string {
  return start === end ? formatDateLabel(start) : `${formatDateLabel(start)} ~ ${formatDateLabel(end)}`;
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
