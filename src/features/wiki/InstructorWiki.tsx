"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import {
  cleanCourseName,
  hasActiveCourse,
  summarizeCompanies,
  type InstructorWikiEntry,
  type InstructorWikiProvenance
} from "./instructorWikiModel";

const STATUS_TABS = [
  { key: "all", label: "전체" },
  { key: "active", label: "진행·예정" },
  { key: "history", label: "이력만" }
] as const;

type StatusTabKey = (typeof STATUS_TABS)[number]["key"];

interface InstructorWikiProps {
  entries: InstructorWikiEntry[];
  loadFailed: boolean;
  provenance: InstructorWikiProvenance;
}

export function InstructorWiki({ entries, loadFailed, provenance }: InstructorWikiProps) {
  const [query, setQuery] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTabKey>("all");
  const [companyFilter, setCompanyFilter] = useState("전체 기업");

  const companyOptions = useMemo(
    () => ["전체 기업", ...uniqueSorted(entries.flatMap((entry) => entry.companies))],
    [entries]
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const searchable = [
        entry.name,
        ...entry.companies,
        ...entry.courses.map((course) => course.courseName),
        ...(entry.coach?.fields ?? [])
      ]
        .join(" ")
        .toLowerCase();
      const queryMatches = !keyword || searchable.includes(keyword);
      const active = hasActiveCourse(entry);
      const statusMatches =
        statusTab === "all" || (statusTab === "active" ? active : !active);
      const companyMatches = companyFilter === "전체 기업" || entry.companies.includes(companyFilter);
      return queryMatches && statusMatches && companyMatches;
    });
  }, [companyFilter, entries, query, statusTab]);

  const activeCount = entries.filter((entry) => hasActiveCourse(entry)).length;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Instructor Wiki" teamScope="both" />

      <section className="content">
        <header className="page-header">
          <div>
            <h1>
              강사위키 <span className="coach-plan-badge">운영 현황 연동</span>
            </h1>
            <p className="lede">
              운영 현황(operations)의 강사 배정을 강사별로 모아 담당 기업·과정을 보여줍니다. coach-db 연결 시 전문분야·평가가 함께 표시됩니다.
            </p>
          </div>
        </header>

        <div className="filter-panel">
          <div className="status-tabs">
            {STATUS_TABS.map((tab) => (
              <button
                className={statusTab === tab.key ? "selected" : ""}
                key={tab.key}
                onClick={() => setStatusTab(tab.key)}
                type="button"
              >
                {tab.label}{" "}
                <span>{tab.key === "all" ? entries.length : tab.key === "active" ? activeCount : entries.length - activeCount}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <select onChange={(event) => setCompanyFilter(event.target.value)} value={companyFilter}>
            {companyOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
          <div className="search">
            <span>🔍</span>
            <input
              aria-label="강사명·기업·과정 검색"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="강사명·기업·과정 검색"
              value={query}
            />
          </div>
          <span className="filter-result-count">총 {filtered.length}명</span>
        </div>

        <div className="table-section">
          <div className="table-header">
            <h2>강사 목록</h2>
            <span>{filtered.length}명</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>강사명</th>
                  <th>담당 기업</th>
                  <th>담당 코스</th>
                  <th>최근 담당 (기업 · 과정)</th>
                  <th>전문분야</th>
                </tr>
              </thead>
              <tbody>
                {loadFailed ? (
                  <tr>
                    <td className="empty-state" colSpan={6}>
                      <strong>운영 현황 데이터를 불러오지 못했습니다.</strong>
                      <span>데이터 연결 상태를 확인해 주세요.</span>
                    </td>
                  </tr>
                ) : filtered.length > 0 ? (
                  filtered.map((entry, index) => {
                    const recent = entry.courses[0];
                    return (
                      <tr key={entry.id}>
                        <td>{index + 1}</td>
                        <td>
                          <Link className="row-link" href={`/instructor-wiki/${encodeURIComponent(entry.name)}`}>
                            <strong>{entry.name}</strong>
                          </Link>
                        </td>
                        <td>{summarizeCompanies(entry.companies)}</td>
                        <td>{entry.courseCount}건</td>
                        <td>
                          {recent ? (
                            <>
                              <span className="title-company">{recent.companyName}</span>{" "}
                              {cleanCourseName(recent.courseName)}
                            </>
                          ) : (
                            <span className="td-muted">-</span>
                          )}
                        </td>
                        <td>
                          {entry.coach && entry.coach.fields.length > 0 ? (
                            entry.coach.fields.slice(0, 3).join(", ")
                          ) : (
                            <span className="td-muted">coach-db 미연결</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={6}>
                      <strong>{provenance === "empty" ? "운영 현황에 강사 정보가 없습니다." : "조건에 맞는 강사가 없습니다."}</strong>
                      <span>{provenance === "empty" ? "운영 현황에 강사가 배정되면 표시됩니다." : "검색어나 필터를 조정해 보세요."}</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
}
