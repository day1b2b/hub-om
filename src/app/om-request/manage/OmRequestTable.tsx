"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { omRequestManagerName, omRequestStatusLabel, type OmRequest } from "@/lib/data/omRequest/omRequestTypes";

type StatusFilter = "전체" | "배정필요" | "배정완료";
type PartFilter = "전체" | "1파트" | "2파트" | "3파트";
type SortDir = "asc" | "desc";
type SortKey = "createdAt" | "team" | "ld" | "manager" | "company" | "courseName" | "start" | "end" | "status" | "assignedOm";

const PAGE_SIZE = 20;

function formatDate(iso: string) {
  return iso.slice(0, 10);
}

function getManager(team: string): string {
  return omRequestManagerName(team) ?? "-";
}

function getDateRange(r: OmRequest): { start: string; end: string } {
  const dates = r.sessions.map((s) => s.date).filter(Boolean);
  const start = dates[0] || "-";
  const end = dates[dates.length - 1] || "-";
  return { start, end };
}

function getSortValue(r: OmRequest, key: SortKey): string {
  const { start, end } = getDateRange(r);
  switch (key) {
    case "createdAt": return r.createdAt;
    case "team": return r.team ?? "";
    case "ld": return r.ld ?? "";
    case "manager": return getManager(r.team);
    case "company": return r.company ?? "";
    case "courseName": return r.courseName ?? "";
    case "start": return start;
    case "end": return end;
    case "status": return r.status;
    case "assignedOm": return r.assignedOm ?? "";
  }
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="sort-icon">
      <span className={active && dir === "asc" ? "sort-active" : ""}>▲</span>
      <span className={active && dir === "desc" ? "sort-active" : ""}>▼</span>
    </span>
  );
}

export function OmRequestTable({ initialRequests }: { initialRequests: OmRequest[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilter>("전체");
  const [partFilter, setPartFilter] = useState<PartFilter>("전체");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const requests = initialRequests;

  const filtered = requests.filter((r) => {
    if (filter !== "전체" && r.status !== filter) return false;
    if (partFilter !== "전체" && !r.team.includes(partFilter)) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      r.ld?.toLowerCase().includes(q) ||
      getManager(r.team).toLowerCase().includes(q) ||
      r.company?.toLowerCase().includes(q) ||
      r.courseName?.toLowerCase().includes(q) ||
      r.assignedOm?.toLowerCase().includes(q)
    );
  });

  const DATE_KEYS = new Set<SortKey>(["createdAt", "start", "end"]);
  const sorted = [...filtered].sort((a, b) => {
    const va = getSortValue(a, sortKey);
    const vb = getSortValue(b, sortKey);
    const cmp = DATE_KEYS.has(sortKey)
      ? va < vb ? -1 : va > vb ? 1 : 0
      : va.localeCompare(vb, "ko");
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const counts = {
    전체: requests.length,
    배정필요: requests.filter((r) => r.status === "배정필요").length,
    배정완료: requests.filter((r) => r.status === "배정완료").length
  };

  const partCounts: Record<PartFilter, number> = {
    전체: requests.length,
    "1파트": requests.filter((r) => r.team.includes("1파트")).length,
    "2파트": requests.filter((r) => r.team.includes("2파트")).length,
    "3파트": requests.filter((r) => r.team.includes("3파트")).length
  };

  function changeFilter(f: StatusFilter) {
    setFilter(f);
    setPage(1);
  }

  function changePartFilter(p: PartFilter) {
    setPartFilter(p);
    setPage(1);
  }

  function changeQuery(q: string) {
    setQuery(q);
    setPage(1);
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  function th(label: string, key: SortKey) {
    return (
      <th className="sortable" onClick={() => handleSort(key)}>
        {label}<SortIcon active={sortKey === key} dir={sortDir} />
      </th>
    );
  }

  return (
    <div className="om-manage-wrap">
      <div className="om-manage-part-filters">
        {(["전체", "1파트", "2파트", "3파트"] as PartFilter[]).map((p) => (
          <button
            key={p}
            className={`om-filter-btn${partFilter === p ? " selected" : ""}`}
            onClick={() => changePartFilter(p)}
          >
            {p} <span className="om-filter-count">{partCounts[p]}</span>
          </button>
        ))}
      </div>
      <div className="om-manage-toolbar">
        <div className="om-manage-filters">
          {(["전체", "배정필요", "배정완료"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              className={`om-filter-btn${filter === s ? " selected" : ""}`}
              onClick={() => changeFilter(s)}
            >
              {s === "전체" ? s : omRequestStatusLabel(s)} <span className="om-filter-count">{counts[s]}</span>
            </button>
          ))}
        </div>
        <div className="om-manage-search">
          <svg className="om-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            className="om-search-input"
            placeholder="검색"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
          />
          {query && (
            <button className="om-search-clear" onClick={() => changeQuery("")}>✕</button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="om-manage-empty">요청이 없습니다.</p>
      ) : (
        <>
          <div className="om-manage-table-wrap">
            <table className="om-manage-table">
              <thead>
                <tr>
                  <th>순번</th>
                  {th("접수일", "createdAt")}
                  <th>구분</th>
                  <th>LD</th>
                  <th>관리자</th>
                  <th>기업명</th>
                  <th>과정명</th>
                  <th>교육형태</th>
                  <th>총 회차</th>
                  {th("시작일", "start")}
                  {th("종료일", "end")}
                  <th>상태</th>
                  <th>OM</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r, i) => {
                  const { start, end } = getDateRange(r);
                  const globalIndex = (page - 1) * PAGE_SIZE + i + 1;
                  return (
                    <tr
                      key={r.id}
                      className={`om-manage-row${r.status === "배정완료" ? " row-done" : ""}`}
                      onClick={() => router.push(`/om-request/manage/${r.id}`)}
                    >
                      <td>{globalIndex}</td>
                      <td>{formatDate(r.createdAt)}</td>
                      <td>{r.team}</td>
                      <td>{r.ld}</td>
                      <td>{getManager(r.team)}</td>
                      <td className="td-left">{r.company}</td>
                      <td className="td-course">{r.courseName}</td>
                      <td>{r.trainingType}</td>
                      <td>{r.totalSessions}회</td>
                      <td>{start}</td>
                      <td>{end}</td>
                      <td>
                        <span className={`om-status-badge ${r.status === "배정필요" ? "need" : "done"}`}>
                          {omRequestStatusLabel(r.status)}
                        </span>
                      </td>
                      <td>{r.assignedOm || <span className="td-muted">-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="om-pagination">
              <button className="om-page-btn" disabled={page === 1} onClick={() => setPage(page - 1)}>‹</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button key={p} className={`om-page-btn${page === p ? " active" : ""}`} onClick={() => setPage(p)}>
                  {p}
                </button>
              ))}
              <button className="om-page-btn" disabled={page === totalPages} onClick={() => setPage(page + 1)}>›</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
