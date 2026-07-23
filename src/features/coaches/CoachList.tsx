"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { CoachSummary } from "@/lib/data/coachTypes";

const SORT_OPTIONS = [
  { value: "workDays", label: "근무일 많은 순" },
  { value: "rating", label: "평가 높은 순" },
  { value: "name", label: "이름순" }
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["value"];

interface CoachListProps {
  coaches: CoachSummary[];
  loadFailed: boolean;
}

export function CoachList({ coaches, loadFailed }: CoachListProps) {
  const [query, setQuery] = useState("");
  const [fieldFilters, setFieldFilters] = useState<Set<string>>(new Set());
  const [workTypeFilters, setWorkTypeFilters] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("workDays");

  const fields = useMemo(() => uniqueSorted(coaches.flatMap((coach) => coach.fields)), [coaches]);
  const workTypes = useMemo(() => uniqueSorted(coaches.flatMap((coach) => splitWorkTypes(coach.workType))), [coaches]);

  const filteredCoaches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return coaches
      .filter((coach) => {
        const searchable = [coach.name, coach.workType ?? "", ...coach.fields].join(" ").toLowerCase();
        const queryMatches = !normalizedQuery || searchable.includes(normalizedQuery);
        // 선택한 항목 중 하나라도 해당하면 통과(OR 매칭). 아무 것도 선택 안 하면 전체 통과.
        const fieldMatches = fieldFilters.size === 0 || coach.fields.some((field) => fieldFilters.has(field));
        const workTypeMatches =
          workTypeFilters.size === 0 || splitWorkTypes(coach.workType).some((workType) => workTypeFilters.has(workType));
        return queryMatches && fieldMatches && workTypeMatches;
      })
      .sort((a, b) => compareCoaches(a, b, sortKey));
  }, [coaches, fieldFilters, query, sortKey, workTypeFilters]);

  function toggleFilter(setState: (updater: (prev: Set<string>) => Set<string>) => void, value: string) {
    setState((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  return (
    <main className="dashboard-shell coach-schedule-shell">
      <AppSidebar label="Coaches" teamScope="both" />

      <section className="content coach-origin-list-content" id="coaches">
        <div className="coach-schedule-topbar">
          <label className="coach-schedule-search">
            <span aria-hidden="true">⌕</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름, 근무유형, 분야 검색"
              type="search"
              value={query}
            />
          </label>
          <div className="coach-schedule-topnav">
            <Link href="/coaches/schedule">코치 일정</Link>
            <Link href="/coaches/my-page">마이페이지</Link>
          </div>
        </div>

        <header className="coach-workspace-header">
          <div>
            <h1>코치 목록</h1>
            <span className="coach-plan-badge">coach-db</span>
          </div>
        </header>
        <p className="coach-origin-list-desc">
          기존 coach-db 기준으로 코치의 공개 프로필, 스케줄, 근무 이력을 조회합니다. 개인정보는 현재 표시하지 않습니다.
        </p>

        <section className="coach-origin-list-toolbar" aria-label="코치 필터">
          <MultiFilterChips
            label="가능 분야"
            onToggle={(value) => toggleFilter(setFieldFilters, value)}
            options={fields}
            selected={fieldFilters}
          />
          <MultiFilterChips
            label="근무유형"
            onToggle={(value) => toggleFilter(setWorkTypeFilters, value)}
            options={workTypes}
            selected={workTypeFilters}
          />
          <SortSelect onChange={setSortKey} value={sortKey} />
        </section>

        <section className="coach-origin-list-card">
          <div className="coach-origin-list-meta">
            <span>총 {filteredCoaches.length}명</span>
          </div>

          {loadFailed ? (
            <div className="coach-origin-empty-panel">
              코치 데이터를 불러오지 못했습니다. 데이터 연결 상태를 확인하세요.
            </div>
          ) : filteredCoaches.length > 0 ? (
            <div className="coach-origin-list-rows">
              {filteredCoaches.map((coach) => (
                <Link className="coach-origin-list-row" href={`/coaches/${coach.id}`} key={coach.id}>
                  <span className="coach-origin-avatar">{coach.name.slice(0, 1)}</span>
                  <span className="coach-origin-row-main">
                    <span>
                      <strong>{coach.name}</strong>
                    </span>
                    <small>
                      {coach.workType || "근무유형 없음"}
                      {coach.fields.length > 0 ? ` · ${coach.fields.slice(0, 4).join(", ")}` : ""}
                    </small>
                  </span>
                  <span className="coach-origin-row-time">
                    근무일 {coach.workDayCount}일 · 평가 {coach.avgRating === null ? "-" : coach.avgRating.toFixed(1)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="coach-origin-empty-panel">
              조건에 맞는 코치가 없습니다. 검색어나 필터를 조정하세요.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function MultiFilterChips({
  label,
  onToggle,
  options,
  selected
}: {
  label: string;
  onToggle: (value: string) => void;
  options: string[];
  selected: Set<string>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const buttonLabel = selected.size > 0 ? `${label} (${selected.size})` : label;

  return (
    <div className="coach-origin-multi-filter" ref={rootRef}>
      <button
        className={selected.size > 0 ? "selected" : ""}
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
      >
        {buttonLabel}
        <i aria-hidden="true">{isOpen ? "▲" : "▼"}</i>
      </button>
      {isOpen && (
        <div className="coach-origin-multi-filter-panel">
          {options.length === 0 ? (
            <span className="coach-origin-multi-filter-empty">옵션 없음</span>
          ) : (
            options.map((option) => (
              <label className="coach-origin-multi-filter-option" key={option}>
                <input
                  checked={selected.has(option)}
                  onChange={() => onToggle(option)}
                  type="checkbox"
                />
                {option}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SortSelect({ onChange, value }: { onChange: (value: SortKey) => void; value: SortKey }) {
  return (
    <label className="coach-origin-filter-select">
      <span>정렬</span>
      <select onChange={(event) => onChange(event.target.value as SortKey)} value={value}>
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function compareCoaches(a: CoachSummary, b: CoachSummary, sortKey: SortKey): number {
  if (sortKey === "rating") return (b.avgRating ?? -1) - (a.avgRating ?? -1) || a.name.localeCompare(b.name, "ko");
  if (sortKey === "name") return a.name.localeCompare(b.name, "ko");
  return b.workDayCount - a.workDayCount || (b.avgRating ?? -1) - (a.avgRating ?? -1) || a.name.localeCompare(b.name, "ko");
}

function splitWorkTypes(value: string | null): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
}
