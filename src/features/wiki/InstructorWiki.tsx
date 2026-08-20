"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import {
  cleanCourseName,
  hasActiveCourse,
  hasOperationHistory,
  ROLE_CLASS,
  roleSummary,
  type InstructorWikiEntry,
  type InstructorWikiProvenance
} from "./instructorWikiModel";
import { WikiAvatar } from "./wikiAvatar";

const STATUS_TABS = [
  { key: "all", label: "전체" },
  { key: "active", label: "진행·예정" },
  { key: "history", label: "이력만" },
  // 노션 강사 DB에는 있지만 운영 배정 이력이 아직 없는 강사(섭외 후보군).
  { key: "none", label: "운영 이력 없음" }
] as const;

type StatusTabKey = (typeof STATUS_TABS)[number]["key"];

interface InstructorWikiProps {
  entries: InstructorWikiEntry[];
  loadFailed: boolean;
  /** 운영 현황에서 집계된 강사 수(노션 명단 합치기 전). 헤더 안내용. */
  operationEntryCount?: number;
  provenance: InstructorWikiProvenance;
  recruitAvoidNames?: string[];
}

export function InstructorWiki({
  entries,
  loadFailed,
  operationEntryCount,
  provenance,
  recruitAvoidNames = []
}: InstructorWikiProps) {
  const [query, setQuery] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTabKey>("all");
  const [companyFilter, setCompanyFilter] = useState("전체 기업");
  const [view, setView] = useState<"gallery" | "list">("gallery");
  const avoidSet = useMemo(() => new Set(recruitAvoidNames), [recruitAvoidNames]);

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
      const hasHistory = hasOperationHistory(entry);
      // "이력만"은 운영 이력이 있고 진행·예정이 없는 강사. 이력이 아예 없는 강사는 별도 탭.
      const statusMatches =
        statusTab === "all" ||
        (statusTab === "active"
          ? active
          : statusTab === "history"
            ? hasHistory && !active
            : !hasHistory);
      const companyMatches = companyFilter === "전체 기업" || entry.companies.includes(companyFilter);
      return queryMatches && statusMatches && companyMatches;
    });
  }, [companyFilter, entries, query, statusTab]);

  const activeCount = entries.filter((entry) => hasActiveCourse(entry)).length;
  const noHistoryCount = entries.filter((entry) => !hasOperationHistory(entry)).length;
  const historyOnlyCount = entries.length - activeCount - noHistoryCount;

  const tabCount = (key: StatusTabKey) =>
    key === "all"
      ? entries.length
      : key === "active"
        ? activeCount
        : key === "history"
          ? historyOnlyCount
          : noHistoryCount;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Instructor Wiki" teamScope="both" />

      <section className="content">
        <header className="page-header">
          <div>
            <h1>
              강사위키{" "}
              <span className="coach-plan-badge">
                {provenance === "notion" ? "노션 강사 DB 연동" : "운영 현황 연동"}
              </span>
            </h1>
            <p className="lede">
              강사 명단·프로필은 노션 강사 DB에서, 담당 기업·과정은 운영 현황(operations)에서 가져옵니다.
              {provenance === "notion" && operationEntryCount !== undefined
                ? ` 전체 ${entries.length}명 중 ${operationEntryCount}명은 운영 배정 이력이 있습니다.`
                : " 노션 동기화를 돌리면 배정 이력이 없는 강사까지 함께 표시됩니다."}
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
                {tab.label} <span>{tabCount(tab.key)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <div className="view-toggle">
            <button className={view === "gallery" ? "selected" : ""} onClick={() => setView("gallery")} type="button">▦ 갤러리</button>
            <button className={view === "list" ? "selected" : ""} onClick={() => setView("list")} type="button">☰ 리스트</button>
          </div>
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

        {view === "gallery" ? (
          <div className="wiki-gallery">
            {loadFailed ? (
              <div className="wiki-empty">
                <strong>운영 현황 데이터를 불러오지 못했습니다.</strong>
                <span>데이터 연결 상태를 확인해 주세요.</span>
              </div>
            ) : filtered.length > 0 ? (
              filtered.map((entry) => {
                const recent = entry.courses[0];
                // 목록에서는 항상 상세로 간다. 노션 이동은 상세 헤더의 강사명 메뉴에서 한다.
                return (
                  <Link className="wiki-card" href={`/instructor-wiki/${encodeURIComponent(entry.name)}`} key={entry.id}>
                    <span className="wiki-card-head">
                      <WikiAvatar name={entry.name} />
                      <span className="wiki-card-name">{entry.name}</span>
                      {avoidSet.has(entry.name) ? <span className="recruit-avoid-tag">⛔ 섭외지양</span> : null}
                    </span>
                    <span className="wiki-card-meta">
                      {hasOperationHistory(entry)
                        ? `${roleSummary(entry).join(" · ") || "강사"} · 코스 ${entry.courseCount}건`
                        : "운영 이력 없음"}
                    </span>
                    {recent ? (
                      <span className="wiki-card-course">{recent.companyName} · {cleanCourseName(recent.courseName)}</span>
                    ) : null}
                  </Link>
                );
              })
            ) : (
              <div className="wiki-empty">
                <strong>{provenance === "empty" ? "표시할 강사가 없습니다." : "조건에 맞는 강사가 없습니다."}</strong>
                <span>
                  {provenance === "empty"
                    ? "관리자 > 데이터 동기화에서 노션 강사 동기화를 실행하거나, 운영 현황에 강사가 배정되면 표시됩니다."
                    : "검색어나 필터를 조정해 보세요."}
                </span>
              </div>
            )}
          </div>
        ) : (
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
                    <th>역할</th>
                    <th>담당 코스</th>
                    <th>최근 담당 (기업 · 과정)</th>
                  </tr>
                </thead>
                <tbody>
                  {loadFailed ? (
                    <tr>
                      <td className="empty-state" colSpan={5}>
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
                            <Link className="row-link row-link--logo" href={`/instructor-wiki/${encodeURIComponent(entry.name)}`}>
                              <WikiAvatar name={entry.name} size="sm" />
                              <strong>{entry.name}</strong>
                              {avoidSet.has(entry.name) ? <span className="recruit-avoid-tag">⛔ 섭외지양</span> : null}
                            </Link>
                          </td>
                          <td>
                            {hasOperationHistory(entry) ? (
                              roleSummary(entry).map((role) => (
                                <span className={`status ${ROLE_CLASS[role]}`} key={role} style={{ marginRight: 4 }}>{role}</span>
                              ))
                            ) : (
                              <span className="td-muted">운영 이력 없음</span>
                            )}
                          </td>
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
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="empty-state" colSpan={5}>
                        <strong>{provenance === "empty" ? "표시할 강사가 없습니다." : "조건에 맞는 강사가 없습니다."}</strong>
                        <span>
                          {provenance === "empty"
                            ? "관리자 > 데이터 동기화에서 노션 강사 동기화를 실행하거나, 운영 현황에 강사가 배정되면 표시됩니다."
                            : "검색어나 필터를 조정해 보세요."}
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
}
