"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { getCompanyDetail } from "./companyDetails";

interface CompanyRow {
  name: string;
}

// 노션 기업위키 원본을 기업명 기준으로 정리(중복 제거·과정명 분리·템플릿 행 제외).
// 실데이터/DB 미연동 UI 미리보기, 상세는 예시 데이터.
const COMPANIES: CompanyRow[] = [
  { name: "삼성전기" },
  { name: "삼성전자" },
  { name: "어플라이드머티어리얼즈코리아" },
  { name: "유한킴벌리" },
  { name: "중앙홀딩스" },
  { name: "KT" },
  { name: "삼양식품" },
  { name: "HL만도" },
  { name: "롯데호텔앤리조트" },
  { name: "현대자동차" },
  { name: "동국제강그룹" },
  { name: "한화인재경영원" },
  { name: "홈앤서비스" },
  { name: "LG경영연구원" },
  { name: "오스테오닉" },
  { name: "CJONS" },
  { name: "롯데면세점" },
  { name: "HD한국조선해양" },
  { name: "CJ ENM" },
  { name: "신한라이프" },
  { name: "동국제약" },
  { name: "두나무" },
  { name: "머티어리얼즈코리아" },
  { name: "현대건설" }
];

export function CompanyWiki() {
  const [selected, setSelected] = useState<CompanyRow | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"gallery" | "list">("gallery");

  // 상세를 열 때 히스토리 항목을 추가해, 브라우저 뒤로가기가 사이트를 벗어나지 않고 목록으로 돌아오게 한다.
  useEffect(() => {
    const onPopState = () => setSelected(null);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function openDetail(company: CompanyRow) {
    setSelected(company);
    window.history.pushState({ companyWiki: company.name }, "");
  }

  function closeDetail() {
    window.history.back();
  }

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = keyword
      ? COMPANIES.filter((company) => company.name.toLowerCase().includes(keyword))
      : COMPANIES;
    // 기업명 가나다순(오름차순) 정렬. 원본 배열을 건드리지 않도록 복사 후 정렬.
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [query]);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Company Wiki" teamScope="both" />

      <section className="content">
        {selected ? (
          <CompanyWikiDetail company={selected} onBack={closeDetail} />
        ) : (
          <>
            <header className="page-header">
              <div>
                <h1>기업위키</h1>
                <p className="lede">기업별 담당자·행정·운영 디테일을 한 곳에서 관리합니다. (UI 미리보기 · 예시 데이터)</p>
              </div>
            </header>

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
                  filtered.map((company) => {
                    const detail = getCompanyDetail(company.name);
                    return (
                      <button className="wiki-card" key={company.name} onClick={() => openDetail(company)} type="button">
                        <span className="wiki-card-head">
                          <CompanyLogo name={company.name} />
                          <span className="wiki-card-name">{company.name}</span>
                        </span>
                        <span className="wiki-card-meta">코스 {detail.courses.length}건 · 담당 {detail.om}</span>
                        {detail.courses[0] ? <span className="wiki-card-course">{detail.courses[0].name}</span> : null}
                      </button>
                    );
                  })
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
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length > 0 ? (
                        filtered.map((company, index) => {
                          const detail = getCompanyDetail(company.name);
                          return (
                            <tr key={company.name}>
                              <td>{index + 1}</td>
                              <td>
                                <button className="row-link row-link--logo" onClick={() => openDetail(company)} type="button">
                                  <CompanyLogo name={company.name} size="sm" />
                                  <strong>{company.name}</strong>
                                </button>
                              </td>
                              <td>{detail.courses.length}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td className="empty-state" colSpan={3}>
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
      </section>
    </main>
  );
}

function CompanyWikiDetail({ company, onBack }: { company: CompanyRow; onBack: () => void }) {
  const detail = getCompanyDetail(company.name);

  return (
    <>
      <button className="back-link" onClick={onBack} type="button">← 기업위키 목록으로</button>

      <div className="detail-header">
        <div className="title-row">
          <CompanyLogo name={company.name} size="lg" />
          <span className="title-company">기업위키</span>
          <h1>{company.name}</h1>
          <span className="sample-tag">예시 데이터</span>
        </div>
        <div className="detail-header-actions">
          <button className="doc-register" type="button">＋ 기업 CI 등록</button>
          <button type="button">수정</button>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-panel">
          <div className="panel-title">기본 정보</div>
          <div className="info-grid">
            <div className="info-item"><span>운영 담당자</span><strong>{detail.om}</strong></div>
            <div className="info-item"><span>운영년도</span><strong>{detail.year}</strong></div>
          </div>
        </div>
        <div className="detail-panel">
          <div className="panel-title">위키 요약</div>
          <div className="info-grid">
            <div className="info-item"><span>매핑 코스</span><strong>{detail.courses.length}건</strong></div>
            <div className="info-item"><span>담당자 정보</span><strong>{detail.contacts.length}명</strong></div>
            <div className="info-item"><span>과정 이력</span><strong>{detail.courseHistory.length}건</strong></div>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>매핑 코스</h2><span>{detail.courses.length}건</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>코스ID</th>
                <th>과정명</th>
                <th>싱크업+운영상세</th>
                <th>강의관리시트</th>
                <th>드라이브</th>
                <th>결과보고서</th>
                <th>담당자</th>
              </tr>
            </thead>
            <tbody>
              {detail.courses.map((course) => (
                <tr key={course.id}>
                  <td><strong>{course.id}</strong></td>
                  <td>{course.name}</td>
                  <td><LinkPill on={course.syncup} /></td>
                  <td><LinkPill on={course.lms} /></td>
                  <td><LinkPill on={course.drive} /></td>
                  <td><LinkPill on={course.report} /></td>
                  <td>{course.instructor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>과정 이력 · 만족도 추이</h2><span>{detail.courseHistory.length}건</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>차수/과정</th>
                <th>진행 시기</th>
                <th>만족도</th>
                <th>핵심 피드백</th>
              </tr>
            </thead>
            <tbody>
              {detail.courseHistory.map((history, index) => (
                <tr key={`${history.label}-${index}`}>
                  <td><strong>{history.label}</strong></td>
                  <td>{history.period}</td>
                  <td>{history.satisfaction}</td>
                  <td>{history.feedback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>담당자 정보</h2><span>{detail.contacts.length}명</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>담당자</th>
                <th>직급</th>
                <th>이메일</th>
                <th>연락처</th>
                <th>커뮤니케이션 스타일</th>
                <th>업무 스타일</th>
              </tr>
            </thead>
            <tbody>
              {detail.contacts.map((contact) => (
                <tr key={contact.name}>
                  <td><strong>{contact.name}</strong></td>
                  <td><span className="role-tag">{contact.role}</span></td>
                  <td>{contact.email}</td>
                  <td>{contact.phone}</td>
                  <td>{contact.comm}</td>
                  <td>{contact.work}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>담당자 운영 디테일</h2></div>
        <div className="section-body">
          <dl className="field-preview-list">
            <div><dt>선호하는 교육 방식</dt><dd>{detail.preferredStyle}</dd></div>
            <div><dt>리텐션 필살기</dt><dd>{detail.retention}</dd></div>
            <div><dt>강사 피드백</dt><dd>{detail.instructorFeedback}</dd></div>
            <div><dt>운영 매니저의 제언 (Insight)</dt><dd>{detail.managerInsight}</dd></div>
          </dl>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>현장/인프라 정보</h2></div>
        <div className="section-body">
          <dl className="field-preview-list">
            <div><dt>교육장 위치</dt><dd>{detail.facility.location}</dd></div>
            <div><dt>출입/보안 절차</dt><dd>{detail.facility.accessSecurity}</dd></div>
            <div><dt>식사/다과</dt><dd>{detail.facility.meal}</dd></div>
            <div><dt>네트워크/보안</dt><dd>{detail.facility.network}</dd></div>
            <div><dt>필수 장비/젠더</dt><dd>{detail.facility.equipment}</dd></div>
            <div><dt>음향/포인터</dt><dd>{detail.facility.audio}</dd></div>
          </dl>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>행정/정산</h2></div>
        <div className="section-body">
          <dl className="field-preview-list">
            <div><dt>정산 프로세스</dt><dd>{detail.settlementProcess}</dd></div>
            <div><dt>증빙 서류 패키지</dt><dd>{detail.evidence}</dd></div>
            <div>
              <dt>증빙 파일</dt>
              <dd>
                <div className="doc-list">
                  {detail.documents.map((doc) => (
                    <div className="doc-row" key={doc.name}>
                      <span className="doc-name">{doc.name}</span>
                      {doc.registered ? (
                        <span className="archive-pill done">등록됨 · 파일 보기</span>
                      ) : (
                        <button className="doc-register" type="button">＋ 파일 등록</button>
                      )}
                    </div>
                  ))}
                </div>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </>
  );
}

function LinkPill({ on }: { on: boolean }) {
  return <span className={on ? "archive-pill done" : "archive-pill needed"}>{on ? "링크 보기" : "미등록"}</span>;
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
