"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { CompanyWikiEntry } from "./companyWikiModel";

interface CompanyWikiProps {
  /** 운영 현황에서 만든 기업 목록. */
  entries: CompanyWikiEntry[];
  /** 운영 현황을 못 읽었을 때. 빈 목록과 구분해서 알려 준다. */
  loadFailed: boolean;
}

/** 여러 명이면 이름을 이어 붙이고, 없으면 대체 문구. */
function nameText(names: string[], fallback: string): string {
  return names.length > 0 ? names.join(", ") : fallback;
}

export function CompanyWiki({ entries, loadFailed }: CompanyWikiProps) {
  const [selectedName, setSelectedName] = useState<null | string>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"gallery" | "list">("gallery");

  // 상세를 열 때 히스토리 항목을 추가해, 브라우저 뒤로가기가 사이트를 벗어나지 않고 목록으로 돌아오게 한다.
  useEffect(() => {
    const onPopState = () => setSelectedName(null);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function openDetail(name: string) {
    setSelectedName(name);
    window.history.pushState({ companyWiki: name }, "");
  }

  function closeDetail() {
    window.history.back();
  }

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(keyword));
  }, [entries, query]);

  const selected = useMemo(
    () => entries.find((entry) => entry.name === selectedName) ?? null,
    [entries, selectedName]
  );

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Company Wiki" teamScope="both" />

      <section className="content">
        {selected ? (
          <CompanyWikiDetail entry={selected} onBack={closeDetail} />
        ) : (
          <>
            <header className="page-header">
              <div>
                <h1>기업위키</h1>
                <p className="lede">운영 현황에 등록된 기업의 코스·운영 이력·담당자를 모아 봅니다.</p>
              </div>
            </header>

            {loadFailed ? (
              <div className="wiki-empty">
                <strong>운영 현황을 불러오지 못했습니다.</strong>
                <span>잠시 후 새로고침해 주세요. 계속되면 관리자에게 알려 주세요.</span>
              </div>
            ) : entries.length === 0 ? (
              <div className="wiki-empty">
                <strong>운영 현황에 등록된 기업이 없습니다.</strong>
                <span>운영 현황에 과정이 등록되면 여기에 기업이 나타납니다.</span>
              </div>
            ) : (
              <>
                <div className="filter-row">
                  <div className="view-toggle">
                    <button className={view === "gallery" ? "selected" : ""} onClick={() => setView("gallery")} type="button">▦ 갤러리</button>
                    <button className={view === "list" ? "selected" : ""} onClick={() => setView("list")} type="button">☰ 리스트</button>
                  </div>
                  <div className="search">
                    <span>🔍</span>
                    <input
                      aria-label="기업명 검색"
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="기업명 검색"
                      value={query}
                    />
                  </div>
                  <span className="filter-result-count">총 {filtered.length}건</span>
                </div>

                {view === "gallery" ? (
                  <div className="wiki-gallery">
                    {filtered.length > 0 ? (
                      filtered.map((entry) => (
                        <button className="wiki-card" key={entry.name} onClick={() => openDetail(entry.name)} type="button">
                          <span className="wiki-card-head">
                            <CompanyLogo name={entry.name} />
                            <span className="wiki-card-name">{entry.name}</span>
                          </span>
                          <span className="wiki-card-meta">
                            코스 {entry.courseCount}건 · 회차 {entry.roundCount}건 · 담당 {nameText(entry.omNames, "배정필요")}
                          </span>
                          {entry.courses[0] ? <span className="wiki-card-course">{entry.courses[0].courseName}</span> : null}
                        </button>
                      ))
                    ) : (
                      <div className="wiki-empty">
                        <strong>검색 결과가 없습니다.</strong>
                        <span>다른 기업명으로 검색해 보세요.</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="table-section">
                    <div className="table-header">
                      <h2>기업 목록</h2>
                      <span>{filtered.length}건</span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>기업명</th>
                            <th>코스 수</th>
                            <th>회차 수</th>
                            <th>담당 OM</th>
                            <th>최근 운영</th>
                            <th>만족도(평균)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.length > 0 ? (
                            filtered.map((entry, index) => (
                              <tr key={entry.name}>
                                <td>{index + 1}</td>
                                <td>
                                  <button className="row-link row-link--logo" onClick={() => openDetail(entry.name)} type="button">
                                    <CompanyLogo name={entry.name} size="sm" />
                                    <strong>{entry.name}</strong>
                                  </button>
                                </td>
                                <td>{entry.courseCount}</td>
                                <td>{entry.roundCount}</td>
                                <td>{nameText(entry.omNames, "배정필요")}</td>
                                <td>{entry.lastDate}</td>
                                <td>{entry.avgSatisfaction}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td className="empty-state" colSpan={7}>
                                <strong>검색 결과가 없습니다.</strong>
                                <span>다른 기업명으로 검색해 보세요.</span>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function CompanyWikiDetail({ entry, onBack }: { entry: CompanyWikiEntry; onBack: () => void }) {
  const yearText = entry.years.length > 0 ? entry.years.join(", ") : "-";

  return (
    <>
      <button className="back-link" onClick={onBack} type="button">← 기업위키 목록으로</button>

      <div className="detail-header">
        <div className="title-row">
          <CompanyLogo name={entry.name} size="lg" />
          <span className="title-company">기업위키</span>
          <h1>{entry.name}</h1>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-panel">
          <div className="panel-title">기본 정보</div>
          <div className="info-grid">
            <div className="info-item"><span>담당 OM</span><strong>{nameText(entry.omNames, "배정필요")}</strong></div>
            <div className="info-item"><span>담당 LD</span><strong>{nameText(entry.ldNames, "미정")}</strong></div>
            <div className="info-item"><span>운영 연도</span><strong>{yearText}</strong></div>
            <div className="info-item"><span>최근 운영</span><strong>{entry.lastDate}</strong></div>
          </div>
        </div>
        <div className="detail-panel">
          <div className="panel-title">위키 요약</div>
          <div className="info-grid">
            <div className="info-item"><span>매핑 코스</span><strong>{entry.courseCount}건</strong></div>
            <div className="info-item"><span>운영 회차</span><strong>{entry.roundCount}건</strong></div>
            <div className="info-item"><span>만족도(평균)</span><strong>{entry.avgSatisfaction}</strong></div>
            <div className="info-item"><span>첫 운영</span><strong>{entry.firstDate}</strong></div>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>매핑 코스</h2><span>{entry.courseCount}건</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>코스ID</th>
                <th>과정명</th>
                <th>회차</th>
                <th>싱크업+운영상세</th>
                <th>강의관리시트</th>
                <th>드라이브</th>
                <th>결과보고서</th>
                <th>강사</th>
                <th>기간</th>
              </tr>
            </thead>
            <tbody>
              {entry.courses.map((course) => (
                <tr key={course.key}>
                  <td><strong>{course.courseId || "검토필요"}</strong></td>
                  <td>
                    <Link className="course-link" href={`/operations/${course.operationId}`}>
                      <strong>{course.courseName}</strong>
                    </Link>
                  </td>
                  <td>{course.rounds}</td>
                  <td><LinkPill on={course.syncup} /></td>
                  <td><LinkPill on={course.lms} /></td>
                  <td><LinkPill on={course.drive} /></td>
                  <td><LinkPill on={course.report} /></td>
                  <td>{course.instructors}</td>
                  <td>{course.startDate === course.endDate ? course.startDate : `${course.startDate} ~ ${course.endDate}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>운영 이력 · 만족도 추이</h2><span>{entry.history.length}건</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>과정명</th>
                <th>회차</th>
                <th>기간</th>
                <th>만족도</th>
                <th>진행상태</th>
              </tr>
            </thead>
            <tbody>
              {entry.history.map((row) => (
                <tr key={row.key}>
                  <td>
                    <Link className="course-link" href={`/operations/${row.operationId}`}>
                      <strong>{row.courseName}</strong>
                    </Link>
                  </td>
                  <td>{row.roundNo}</td>
                  <td>{row.period}</td>
                  <td>{row.satisfaction}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 아래 항목은 운영 현황에 없는 정보다. 예전에는 기업명 해시로 만든 값을 채워 넣었는데,
          실제 담당자 연락처·보안 절차·정산 조건으로 읽힐 수 있어 지어내지 않고 비워 둔다. */}
      <div className="detail-section">
        <div className="section-title"><h2>아직 기록되지 않은 정보</h2></div>
        <div className="section-body">
          <div className="empty-state">
            <strong>운영 현황에 없는 항목입니다.</strong>
            <span>
              고객사 담당자 연락처·커뮤니케이션 스타일, 교육장·출입 보안·네트워크·장비,
              정산 프로세스·증빙 서류, 운영 제언은 운영 현황에서 가져올 수 없어 비워 두었습니다.
              입력해서 쌓는 기능은 별도로 붙일 예정입니다.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function LinkPill({ on }: { on: boolean }) {
  return <span className={on ? "archive-pill done" : "archive-pill needed"}>{on ? "등록" : "미등록"}</span>;
}

// 실제 로고 이미지 대신, 기업명 이니셜 + 결정적 색상 배지(플레이스홀더).
function logoMonogram(name: string): string {
  const trimmed = name.trim();
  const ascii = trimmed.match(/^[A-Za-z]+/);
  if (ascii) return ascii[0].slice(0, 2).toUpperCase();
  return trimmed.slice(0, 1);
}

function logoColor(name: string): string {
  let hue = 0;
  for (let index = 0; index < name.length; index += 1) hue = (hue * 31 + name.charCodeAt(index)) % 360;
  return `hsl(${hue}, 52%, 45%)`;
}

function CompanyLogo({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`wiki-logo wiki-logo-${size}`} style={{ background: logoColor(name) }}>
      {logoMonogram(name)}
    </span>
  );
}
