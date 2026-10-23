"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { CoachActivity, CoachActivityStatus } from "@/lib/coaches/coachActivity";
import type { CoachSummary } from "@/lib/data/coachTypes";
import { CoachAvatarIcon } from "./CoachAvatarIcon";

/** 목록 한 줄. 활동 상태는 서버에서 오늘 기준으로 계산해 넘긴다. */
export type CoachListItem = Omit<CoachSummary, "engagementFacts"> & { activity: CoachActivity };

const ACTIVITY_LABEL: Record<CoachActivityStatus, string> = {
  active: "활동",
  never: "미투입",
  dormant: "휴면"
};

const ACTIVITY_CLASS: Record<CoachActivityStatus, string> = {
  active: "active",
  never: "planned-assignment",
  dormant: "muted"
};

const ACTIVITY_TABS = [
  { key: "all", label: "전체" },
  { key: "active", label: "활동" },
  { key: "never", label: "미투입" },
  { key: "dormant", label: "휴면" }
] as const;

type ActivityTabKey = (typeof ACTIVITY_TABS)[number]["key"];

const SORT_OPTIONS = [
  { value: "recent", label: "최근 투입순" },
  { value: "deploys", label: "투입 많은 순" },
  { value: "workDays", label: "근무일 많은 순" },
  { value: "rating", label: "최근 평균 높은 순" },
  { value: "name", label: "이름순" }
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["value"];

interface CoachListProps {
  coaches: CoachListItem[];
  loadFailed: boolean;
  /** 한국 기준 오늘(YYYY-MM-DD). 날짜 표기에 쓴다. */
  today: string;
}

export function CoachList({ coaches, loadFailed, today }: CoachListProps) {
  const [query, setQuery] = useState("");
  const [activityTab, setActivityTab] = useState<ActivityTabKey>("all");
  const [fieldFilters, setFieldFilters] = useState<Set<string>>(new Set());
  const [workTypeFilters, setWorkTypeFilters] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("recent");

  const fields = useMemo(() => uniqueSorted(coaches.flatMap((coach) => coach.fields)), [coaches]);
  const workTypes = useMemo(() => uniqueSorted(coaches.flatMap((coach) => splitWorkTypes(coach.workType))), [coaches]);

  const activityCounts = useMemo(() => {
    const counts: Record<ActivityTabKey, number> = { all: coaches.length, active: 0, never: 0, dormant: 0 };
    for (const coach of coaches) counts[coach.activity.status] += 1;
    return counts;
  }, [coaches]);

  const filteredCoaches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return coaches
      .filter((coach) => {
        const searchable = [coach.name, coach.workType ?? "", ...coach.fields].join(" ").toLowerCase();
        const queryMatches = !normalizedQuery || searchable.includes(normalizedQuery);
        const activityMatches = activityTab === "all" || coach.activity.status === activityTab;
        // 선택한 항목을 전부 가지고 있어야 통과(AND 매칭). 아무 것도 선택 안 하면 전체 통과.
        const coachWorkTypes = splitWorkTypes(coach.workType);
        const fieldMatches = [...fieldFilters].every((field) => coach.fields.includes(field));
        const workTypeMatches = [...workTypeFilters].every((workType) => coachWorkTypes.includes(workType));
        return queryMatches && activityMatches && fieldMatches && workTypeMatches;
      })
      .sort((a, b) => compareCoaches(a, b, sortKey));
  }, [activityTab, coaches, fieldFilters, query, sortKey, workTypeFilters]);

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
        <header className="coach-workspace-header">
          <div>
            <h1>코치 목록</h1>
          </div>
        </header>
        <p className="coach-origin-list-desc">
          활동 {activityCounts.active}명 · 미투입 {activityCounts.never}명 · 휴면 {activityCounts.dormant}명.
          활동 상태와 최근 평균은 투입 이력으로 계산합니다.
        </p>

        <div className="filter-panel">
          <div className="status-tabs">
            {ACTIVITY_TABS.map((tab) => (
              <button
                className={activityTab === tab.key ? "selected" : ""}
                key={tab.key}
                onClick={() => setActivityTab(tab.key)}
                type="button"
              >
                {tab.label} <span>{activityCounts[tab.key]}</span>
              </button>
            ))}
          </div>
        </div>

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
          <span className="coach-origin-toolbar-spacer" />
          <label className="coach-schedule-search">
            <span aria-hidden="true">⌕</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름, 근무유형, 분야 검색"
              type="search"
              value={query}
            />
          </label>
        </section>

        <section className="table-section">
          <div className="table-header">
            <h2>코치</h2>
            <span>총 {filteredCoaches.length}명</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>활동 상태</th>
                  <th>가능 분야</th>
                  <th>투입 · 근무일</th>
                  <th>최근 투입</th>
                  <th>최근 평균</th>
                  <th>노션</th>
                </tr>
              </thead>
              <tbody>
                {loadFailed ? (
                  <tr>
                    <td className="empty-state" colSpan={7}>
                      <strong>코치 데이터를 불러오지 못했습니다.</strong>
                      <span>데이터 연결 상태를 확인하세요.</span>
                    </td>
                  </tr>
                ) : filteredCoaches.length > 0 ? (
                  filteredCoaches.map((coach) => (
                    <tr key={coach.id}>
                      <td>
                        <Link className="row-link row-link--logo" href={`/coaches/${coach.id}`}>
                          <span className="coach-doc-icon"><CoachAvatarIcon /></span>
                          <span>
                            <strong>{coach.name}</strong>
                            <br />
                            <span className="td-muted">
                              {coach.workType || "근무유형 없음"}
                              {coach.status === "inactive" ? " · 코치 DB 비활동" : ""}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className={`status ${ACTIVITY_CLASS[coach.activity.status]}`}>
                          {ACTIVITY_LABEL[coach.activity.status]}
                        </span>
                        {coach.activity.upcomingCount > 0 ? (
                          <span className="td-muted"> 예정 {coach.activity.upcomingCount}건</span>
                        ) : null}
                      </td>
                      <td>
                        {coach.fields.length > 0 ? (
                          <>
                            {coach.fields.slice(0, 3).join(", ")}
                            {coach.fields.length > 3 ? <span className="td-muted"> 외 {coach.fields.length - 3}</span> : null}
                          </>
                        ) : (
                          <span className="td-muted">-</span>
                        )}
                      </td>
                      <td>
                        {coach.activity.deployCount}회 · {coach.workDayCount}일
                      </td>
                      <td>
                        {coach.activity.lastDeployDate ? (
                          formatShortDate(coach.activity.lastDeployDate, today)
                        ) : (
                          <span className="td-muted">-</span>
                        )}
                      </td>
                      <td>
                        <RecentRating count={coach.recentRatingCount} value={coach.recentAvgRating} />
                      </td>
                      <td>
                        {coach.notionPageId ? (
                          <a
                            className="coach-origin-notion-link"
                            href={`https://www.notion.so/${coach.notionPageId.replaceAll("-", "")}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            노션
                          </a>
                        ) : (
                          <span className="td-muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={7}>
                      <strong>조건에 맞는 코치가 없습니다.</strong>
                      <span>검색어나 필터를 조정하세요.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

/** 평균은 기준 건수를 채웠을 때만 보여준다. 모자라면 건수만, 없으면 "-". */
function RecentRating({ count, value }: { count: number; value: number | null }) {
  if (value !== null) {
    return (
      <>
        {value.toFixed(1)} <span className="td-muted">({count}건)</span>
      </>
    );
  }
  if (count > 0) return <span className="td-muted">평가 {count}건</span>;
  return <span className="td-muted">-</span>;
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

function compareCoaches(a: CoachListItem, b: CoachListItem, sortKey: SortKey): number {
  const byName = a.name.localeCompare(b.name, "ko");
  if (sortKey === "name") return byName;
  if (sortKey === "rating") return (b.recentAvgRating ?? -1) - (a.recentAvgRating ?? -1) || byName;
  if (sortKey === "deploys") return b.activity.deployCount - a.activity.deployCount || byName;
  if (sortKey === "workDays") return b.workDayCount - a.workDayCount || byName;
  // 최근 투입순: 투입 이력이 없는 코치는 뒤로.
  return (b.activity.lastDeployDate ?? "").localeCompare(a.activity.lastDeployDate ?? "") || byName;
}

/** 올해면 "10.16", 아니면 "2025.10.16". */
function formatShortDate(dateKey: string, today: string): string {
  const [year, month, day] = dateKey.split("-");
  const short = `${Number(month)}.${Number(day)}`;
  return year === today.slice(0, 4) ? short : `${year}.${short}`;
}

function splitWorkTypes(value: string | null): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
}
