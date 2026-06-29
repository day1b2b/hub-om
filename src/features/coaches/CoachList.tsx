"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { CoachStatusValue, CoachSummary } from "@/lib/data/coachTypes";

const STATUS_FILTERS = ["전체", "활동중", "대기", "비활동"] as const;
const VISIBILITY_FILTERS = ["전체", "노출", "비노출"] as const;
const SORT_OPTIONS = [
  { value: "workDays", label: "근무일 많은 순" },
  { value: "rating", label: "평가 높은 순" },
  { value: "name", label: "이름순" }
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["value"];

const STATUS_LABEL: Record<CoachStatusValue, string> = {
  active: "활동중",
  pending: "대기",
  inactive: "비활동"
};

const STATUS_CLASS: Record<CoachStatusValue, string> = {
  active: "active",
  pending: "planned-assignment",
  inactive: "needs-assignment"
};

interface CoachListProps {
  coaches: CoachSummary[];
  loadFailed: boolean;
}

export function CoachList({ coaches, loadFailed }: CoachListProps) {
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("전체");
  const [visibilityFilter, setVisibilityFilter] = useState<(typeof VISIBILITY_FILTERS)[number]>("전체");
  const [query, setQuery] = useState("");
  const [fieldFilter, setFieldFilter] = useState("전체");
  const [workTypeFilter, setWorkTypeFilter] = useState("전체");
  const [sortKey, setSortKey] = useState<SortKey>("workDays");

  const fields = useMemo(() => uniqueSorted(coaches.flatMap((coach) => coach.fields)), [coaches]);
  const workTypes = useMemo(() => uniqueSorted(coaches.flatMap((coach) => splitWorkTypes(coach.workType))), [coaches]);

  const filteredCoaches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return coaches
      .filter((coach) => {
        const searchable = [coach.name, coach.workType ?? "", ...coach.fields].join(" ").toLowerCase();
        const queryMatches = !normalizedQuery || searchable.includes(normalizedQuery);
        const statusMatches = statusFilter === "전체" || STATUS_LABEL[coach.status] === statusFilter;
        const visibilityMatches = visibilityFilter === "전체" || visibilityLabel(coach) === visibilityFilter;
        const fieldMatches = fieldFilter === "전체" || coach.fields.includes(fieldFilter);
        const workTypeMatches = workTypeFilter === "전체" || splitWorkTypes(coach.workType).includes(workTypeFilter);
        return queryMatches && statusMatches && visibilityMatches && fieldMatches && workTypeMatches;
      })
      .sort((a, b) => compareCoaches(a, b, sortKey));
  }, [coaches, fieldFilter, query, sortKey, statusFilter, visibilityFilter, workTypeFilter]);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Coaches" teamScope="both" />

      <section className="content coach-origin-list-content" id="coaches">
        <header className="coach-origin-list-header">
          <div>
            <p className="eyebrow">코치 DB</p>
            <h1>코치 목록</h1>
            <p>기존 coach-db 기준으로 코치의 공개 프로필, 스케줄, 근무 이력을 조회합니다. 개인정보는 현재 표시하지 않습니다.</p>
          </div>
          <Link className="coach-origin-primary-link" href="/coaches/schedule">코치 일정</Link>
        </header>

        <section className="coach-origin-list-toolbar" aria-label="코치 검색과 필터">
          <label className="coach-origin-list-search">
            <span aria-hidden="true">⌕</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름, 근무유형, 분야 검색"
              type="search"
              value={query}
            />
          </label>
          <FilterSelect
            label="상태"
            onChange={(value) => setStatusFilter(value as (typeof STATUS_FILTERS)[number])}
            options={[...STATUS_FILTERS]}
            value={statusFilter}
          />
          <FilterSelect
            label="노출"
            onChange={(value) => setVisibilityFilter(value as (typeof VISIBILITY_FILTERS)[number])}
            options={[...VISIBILITY_FILTERS]}
            value={visibilityFilter}
          />
          <FilterSelect label="가능 분야" onChange={setFieldFilter} options={["전체", ...fields]} value={fieldFilter} />
          <FilterSelect label="근무유형" onChange={setWorkTypeFilter} options={["전체", ...workTypes]} value={workTypeFilter} />
          <SortSelect onChange={setSortKey} value={sortKey} />
        </section>

        <section className="coach-origin-list-card">
          <div className="coach-origin-list-meta">
            <strong>코치 목록</strong>
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
                      <i className={`status ${STATUS_CLASS[coach.status]}`}>{STATUS_LABEL[coach.status]}</i>
                      {!coach.isActive ? <i className="coach-origin-state-badge hidden">비노출</i> : null}
                    </span>
                    <small>
                      {coach.workType || "근무유형 없음"}
                      {coach.fields.length > 0 ? ` · ${coach.fields.slice(0, 4).join(", ")}` : ""}
                    </small>
                  </span>
                  <span className="coach-origin-row-stat">
                    <small>근무일</small>
                    <strong>{coach.workDayCount}</strong>
                  </span>
                  <span className="coach-origin-row-stat">
                    <small>평가</small>
                    <strong>{coach.avgRating === null ? "-" : coach.avgRating.toFixed(1)}</strong>
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

function FilterSelect({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="coach-origin-filter-select">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
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
  const deletedOrder = Number(Boolean(a.deletedAt)) - Number(Boolean(b.deletedAt));
  if (deletedOrder !== 0) return deletedOrder;
  const visibleOrder = Number(!a.isActive) - Number(!b.isActive);
  if (visibleOrder !== 0) return visibleOrder;
  const activeOrder = statusOrder(a.status) - statusOrder(b.status);
  if (activeOrder !== 0) return activeOrder;
  if (sortKey === "rating") return (b.avgRating ?? -1) - (a.avgRating ?? -1) || a.name.localeCompare(b.name, "ko");
  if (sortKey === "name") return a.name.localeCompare(b.name, "ko");
  return b.workDayCount - a.workDayCount || (b.avgRating ?? -1) - (a.avgRating ?? -1) || a.name.localeCompare(b.name, "ko");
}

function visibilityLabel(coach: CoachSummary): (typeof VISIBILITY_FILTERS)[number] {
  return coach.isActive ? "노출" : "비노출";
}

function statusOrder(status: CoachStatusValue): number {
  if (status === "active") return 0;
  if (status === "pending") return 1;
  return 2;
}

function splitWorkTypes(value: string | null): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
}
