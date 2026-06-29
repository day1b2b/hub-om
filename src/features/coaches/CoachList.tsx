"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { CoachStatusValue, CoachSummary } from "@/lib/data/coachTypes";

const STATUS_FILTERS = ["전체", "활성", "대기", "비활성"] as const;

const STATUS_LABEL: Record<CoachStatusValue, string> = {
  active: "활성",
  pending: "대기",
  inactive: "비활성"
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
  const [query, setQuery] = useState("");

  const statusCounts = useMemo(() => {
    return {
      전체: coaches.length,
      활성: coaches.filter((coach) => coach.status === "active").length,
      대기: coaches.filter((coach) => coach.status === "pending").length,
      비활성: coaches.filter((coach) => coach.status === "inactive").length
    };
  }, [coaches]);

  const filteredCoaches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return coaches.filter((coach) => {
      const queryMatches = !normalizedQuery || coach.name.toLowerCase().includes(normalizedQuery);
      const statusMatches = statusFilter === "전체" || STATUS_LABEL[coach.status] === statusFilter;
      return queryMatches && statusMatches;
    });
  }, [coaches, query, statusFilter]);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Coaches" teamScope="both" />

      <section className="content operations-page" id="coaches">
        <header className="page-header">
          <div>
            <p className="eyebrow">코치 DB</p>
            <h1>코치 목록</h1>
            <p className="lede">이름, 상태, 분야 기준으로 코치를 조회합니다. 연락처 등 개인정보는 상세 화면에서 권한이 있을 때만 표시됩니다.</p>
          </div>
          <div className="header-panel">
            <span>등록 코치</span>
            <strong>{coaches.length}명</strong>
          </div>
        </header>

        <section className="status-tabs" aria-label="상태 필터">
          {STATUS_FILTERS.map((item) => (
            <button
              aria-pressed={statusFilter === item}
              className={statusFilter === item ? "selected" : ""}
              key={item}
              onClick={() => setStatusFilter(item)}
              type="button"
            >
              {item}
              <span>{statusCounts[item]}</span>
            </button>
          ))}
        </section>

        <section className="filter-panel operations-filter-panel" aria-label="검색">
          <label className="search">
            <span>검색</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="코치 이름"
              type="search"
              value={query}
            />
          </label>
          <span className="filter-result-count">총 {filteredCoaches.length}명</span>
        </section>

        <section className="dashboard-panel operations-list-panel">
          <div className="section-title">
            <h2>코치 목록</h2>
            <div className="dashboard-table-meta">
              <span>{filteredCoaches.length}명</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>이름</th>
                  <th>근무유형</th>
                  <th>상태</th>
                  <th>활동</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoaches.length > 0 ? (
                  filteredCoaches.map((coach, index) => (
                    <tr key={coach.id}>
                      <td>{index + 1}</td>
                      <td>
                        <Link className="course-link" href={`/coaches/${coach.id}`}>
                          <strong>{coach.name}</strong>
                        </Link>
                      </td>
                      <td>{coach.workType || "-"}</td>
                      <td>
                        <span className={`status ${STATUS_CLASS[coach.status]}`}>{STATUS_LABEL[coach.status]}</span>
                      </td>
                      <td>{coach.isActive ? "활동중" : "비활동"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={5}>
                      <strong>{loadFailed ? "코치 데이터를 불러오지 못했습니다." : "표시할 코치가 없습니다."}</strong>
                      <span>
                        {loadFailed
                          ? "데이터 연결 상태를 확인하세요."
                          : "검색어나 상태 필터를 조정하거나 코치 데이터를 동기화하세요."}
                      </span>
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
