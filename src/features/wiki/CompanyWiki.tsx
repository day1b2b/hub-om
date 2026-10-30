"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { CompanyWikiEntry } from "./companyWikiModel";
import { emptyCompanyBusinessInfo, type CompanyBusinessInfo } from "@/lib/data/companyBusinessInfoTypes";
import { CompanyBusinessInfoEditor } from "./CompanyBusinessInfoEditor";
import { CompanyMemoEditor } from "./CompanyMemoEditor";

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

const PAGE_SIZE = 20;

export function CompanyWiki({ entries, loadFailed }: CompanyWikiProps) {
  const [selectedName, setSelectedName] = useState<null | string>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"gallery" | "list">("gallery");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("");

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

  // 검색/목록이 바뀌면 현재 페이지를 유효 범위로 맞춰 빈 페이지가 뜨지 않게 한다.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageNumbers = getPageNumbers(currentPage, totalPages);

  function handleQueryChange(value: string) {
    setQuery(value);
    setPage(1);
  }

  function goToPage(target: number) {
    setPage(Math.min(Math.max(1, target), totalPages));
  }

  function goToInputPage() {
    const parsed = Number(pageInput);
    if (Number.isFinite(parsed) && parsed >= 1) goToPage(Math.floor(parsed));
    setPageInput("");
  }

  const selected = useMemo(
    () => entries.find((entry) => entry.name === selectedName) ?? null,
    [entries, selectedName]
  );

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Company Wiki" teamScope="both" />

      <section className="content">
        {selected ? (
          <CompanyWikiDetail key={selected.name} entry={selected} onBack={closeDetail} />
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
                      onChange={(event) => handleQueryChange(event.target.value)}
                      placeholder="기업명 검색"
                      value={query}
                    />
                  </div>
                  <span className="filter-result-count">총 {filtered.length}건</span>
                </div>

                {view === "gallery" ? (
                  <div className="wiki-gallery">
                    {filtered.length > 0 ? (
                      paged.map((entry) => (
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
                            paged.map((entry, index) => (
                              <tr key={entry.name}>
                                <td>{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
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

                {totalPages > 1 ? (
                  <nav className="operations-pagination" aria-label="페이지 이동">
                    <button type="button" className="page-nav" disabled={currentPage <= 1} onClick={() => goToPage(1)}>처음</button>
                    <button type="button" className="page-nav" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>이전</button>
                    {pageNumbers.map((pageNumber, index) =>
                      pageNumber === "ellipsis" ? (
                        <span key={`ellipsis-${index}`} className="page-ellipsis">…</span>
                      ) : (
                        <button
                          key={pageNumber}
                          type="button"
                          className={pageNumber === currentPage ? "page-number is-active" : "page-number"}
                          aria-current={pageNumber === currentPage ? "page" : undefined}
                          onClick={() => goToPage(pageNumber)}
                        >
                          {pageNumber}
                        </button>
                      )
                    )}
                    <button type="button" className="page-nav" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)}>다음</button>
                    <button type="button" className="page-nav" disabled={currentPage >= totalPages} onClick={() => goToPage(totalPages)}>끝</button>
                    <span className="page-jump">
                      <input
                        aria-label="이동할 페이지 번호"
                        max={totalPages}
                        min={1}
                        onChange={(event) => setPageInput(event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Enter") goToInputPage(); }}
                        placeholder={String(currentPage)}
                        type="number"
                        value={pageInput}
                      />
                      <button type="button" onClick={goToInputPage}>이동</button>
                    </span>
                  </nav>
                ) : null}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function CompanyWikiDetail({
  entry,
  onBack
}: {
  entry: CompanyWikiEntry;
  onBack: () => void;
}) {
  // 사업자등록증 정보(PII)는 목록 화면에서 한 번에 내려받지 않고, 상세를 열 때 이 기업
  // 것만 따로 불러온다 — 기업위키가 전체 워크스페이스에 열려 있어 노출 범위를 좁혀야 한다.
  const [businessInfo, setBusinessInfo] = useState<CompanyBusinessInfo | null>(null);

  useEffect(() => {
    if (!entry.companyId) return;
    let cancelled = false;
    fetch(`/api/company-wiki/business-info?companyId=${encodeURIComponent(entry.companyId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setBusinessInfo(data?.businessInfo ?? emptyCompanyBusinessInfo());
      })
      .catch(() => {
        if (!cancelled) setBusinessInfo(emptyCompanyBusinessInfo());
      });
    return () => { cancelled = true; };
    // entry는 CompanyWikiDetail의 key(회사명)가 바뀔 때만 이 컴포넌트와 함께 새로 만들어진다 — 마운트당 한 번만 불러오면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 계산서 발행 요청 구글폼 URL은 서버에만 둔다(저장소가 public이라 클라이언트 번들에
  // 절대 넣지 않는다) — 완성된 링크만 코스별로 서버에서 만들어 받는다.
  const [invoiceLinks, setInvoiceLinks] = useState<Record<string, string | null>>({});
  // 계산서 발행 요청 현황(폼 응답 시트 기준). null이면 아직 불러오는 중, available=false면 시트를 못 읽음.
  const [invoiceStatuses, setInvoiceStatuses] = useState<{
    available: boolean;
    byKey: Record<string, InvoiceRequestStatusView | null>;
  } | null>(null);

  useEffect(() => {
    if (entry.courses.length === 0) return;
    let cancelled = false;
    fetch("/api/company-wiki/invoice-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: entry.companyId,
        companyName: entry.name,
        courses: entry.courses.map((course) => ({ key: course.key, courseId: course.courseId, courseIdLabel: course.courseIdLabel }))
      })
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setInvoiceLinks(data?.links ?? {});
        setInvoiceStatuses({ available: data?.statusAvailable === true, byKey: data?.statuses ?? {} });
      })
      .catch(() => {
        if (!cancelled) setInvoiceStatuses({ available: false, byKey: {} });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <div className="detail-panel">
        <div className="panel-title">위키 요약</div>
        <div className="info-grid info-grid--row-5">
          <div className="info-item"><span>운영 현황</span><strong>{entry.courseCount}건</strong></div>
          <div className="info-item"><span>운영 회차</span><strong>{entry.roundCount}건</strong></div>
          <div className="info-item"><span>만족도(평균)</span><strong>{entry.avgSatisfaction}</strong></div>
          <div className="info-item"><span>첫 운영</span><strong>{entry.firstDate}</strong></div>
          <div className="info-item"><span>매출(코스ID기준)</span><strong>{entry.totalRevenue}</strong></div>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>운영 현황 및 계산서 발행 내역</h2><span>{entry.courseCount}건</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>코스ID</th>
                <th>과정명</th>
                <th>OM</th>
                <th>LD</th>
                <th>회차</th>
                <th>시작일</th>
                <th>종료일</th>
                <th>강사</th>
                <th>만족도(평균)</th>
                <th>매출(코스ID기준)</th>
                <th>계산서 발행 요청</th>
                <th>발행 요청 현황</th>
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
                  <td>{course.om}</td>
                  <td>{course.ld}</td>
                  <td>{course.rounds}</td>
                  <td>{course.startDate}</td>
                  <td>{course.endDate}</td>
                  <td>{course.instructors}</td>
                  <td>{course.avgSatisfaction}</td>
                  <td>{course.revenue}</td>
                  <td><InvoiceRequestLink href={invoiceLinks[course.key]} /></td>
                  <td>
                    <InvoiceRequestStatusBadge
                      hasCourseId={Boolean(course.courseId)}
                      state={invoiceStatuses}
                      status={invoiceStatuses?.byKey[course.key] ?? null}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!entry.companyId ? (
        <div className="detail-section">
          <div className="section-title"><h2>사업자등록증 정보</h2></div>
          <div className="section-body">
            <div className="empty-state">
              <strong>이 기업은 아직 사업자등록증 정보를 입력할 수 없습니다.</strong>
              <span>운영 현황 원천에 기업 식별자(companyId)가 없는 데이터라서 그렇습니다. 업무요청으로 접수된 기업만 입력할 수 있어요.</span>
            </div>
          </div>
        </div>
      ) : businessInfo ? (
        <>
          <CompanyBusinessInfoEditor companyId={entry.companyId} initial={businessInfo} />
          <CompanyMemoEditor companyId={entry.companyId} initial={businessInfo.memo} />
        </>
      ) : (
        <div className="detail-section">
          <div className="section-title"><h2>사업자등록증 정보</h2></div>
          <div className="section-body"><p className="field-hint">불러오는 중…</p></div>
        </div>
      )}
    </>
  );
}

// 링크는 서버(/api/company-wiki/invoice-link)에서 완성된 형태로 받는다 — 구글폼 URL을
// 클라이언트 코드에 두지 않기 위해서다(저장소가 public). undefined는 "아직 불러오는 중",
// null은 "서버가 안전한 URL을 못 만들었음"이고, 화면에서는 둘 다 "-"로 같다.
function InvoiceRequestLink({ href }: { href: string | null | undefined }) {
  if (!href) return <span className="muted-inline">-</span>;

  return (
    <a className="invoice-request-link" href={href} rel="noreferrer" target="_blank">
      계산서 발행 요청
    </a>
  );
}

interface InvoiceRequestStatusView {
  lastRequestedAt: string;
  requestCount: number;
}

// 폼 응답 시트에 이 코스ID로 들어온 요청이 있으면 "요청 완료". 코스ID가 없으면 시트와 맞춰 볼
// 방법이 없어 "-", 시트를 못 읽었으면 "미요청"으로 오해하지 않게 "확인 불가"로 둔다.
function InvoiceRequestStatusBadge({
  hasCourseId,
  state,
  status
}: {
  hasCourseId: boolean;
  state: { available: boolean } | null;
  status: InvoiceRequestStatusView | null;
}) {
  if (!state) return <span className="muted-inline">불러오는 중…</span>;
  if (!hasCourseId) return <span className="muted-inline">-</span>;
  if (!state.available) return <span className="muted-inline" title="계산서 발급 신청 시트를 읽지 못했습니다.">확인 불가</span>;
  if (!status) return <span className="invoice-status invoice-status--pending">미요청</span>;

  const title = `마지막 요청: ${status.lastRequestedAt || "시각 미기재"}${status.requestCount > 1 ? ` · 총 ${status.requestCount}건` : ""}`;
  return (
    <span className="invoice-status invoice-status--done" title={title}>
      요청 완료{status.requestCount > 1 ? ` (${status.requestCount}건)` : ""}
    </span>
  );
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

// 운영현황 화면(OperationDashboard.tsx)의 페이지네이션과 같은 방식(현재 페이지 중심 3개 창).
function getPageNumbers(current: number, total: number): Array<number | "ellipsis"> {
  const windowSize = 3;
  let start = current - 1;
  let end = current + 1;

  if (start < 1) {
    start = 1;
    end = Math.min(total, windowSize);
  }
  if (end > total) {
    end = total;
    start = Math.max(1, total - windowSize + 1);
  }

  const pages: Array<number | "ellipsis"> = [];
  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) pages.push(pageNumber);
  return pages;
}
