"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { getCompanyDetail } from "./companyDetails";

interface CompanyStatus {
  cls: string;
  label: string;
}

interface CompanyRow {
  name: string;
  status?: CompanyStatus;
}

const ACTIVE: CompanyStatus = { cls: "active", label: "운영중" };
const STOPPED: CompanyStatus = { cls: "needs-assignment", label: "중단" };

// 노션 기업위키 원본을 기업명 기준으로 정리(중복 제거·과정명 분리·템플릿 행 제외).
// 실데이터/DB 미연동 UI 미리보기, 상세는 예시 데이터.
const COMPANIES: CompanyRow[] = [
  { name: "삼성전기", status: ACTIVE },
  { name: "삼성전자", status: ACTIVE },
  { name: "어플라이드머티어리얼즈코리아", status: ACTIVE },
  { name: "유한킴벌리", status: ACTIVE },
  { name: "중앙홀딩스", status: ACTIVE },
  { name: "KT", status: STOPPED },
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
    if (!keyword) return COMPANIES;
    return COMPANIES.filter((company) => company.name.toLowerCase().includes(keyword));
  }, [query]);

  const operatingCount = COMPANIES.filter((company) => company.status?.cls === "active").length;
  const stoppedCount = COMPANIES.filter((company) => company.status?.cls === "needs-assignment").length;
  const needsReviewCount = COMPANIES.filter((company) => !company.status).length;

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

            <div className="filter-panel">
              <div className="status-tabs">
                <button className="selected" type="button">전체 <span>{COMPANIES.length}</span></button>
                <button type="button">운영중 <span>{operatingCount}</span></button>
                <button type="button">중단 <span>{stoppedCount}</span></button>
                <button type="button">확인필요 <span>{needsReviewCount}</span></button>
              </div>
            </div>

            <div className="filter-row">
              <select><option>전체 담당 OM</option></select>
              <select><option>전체 운영년도</option></select>
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
                      <th>상태</th>
                      <th>담당 OM</th>
                      <th>운영년도</th>
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
                              <button className="row-link" onClick={() => openDetail(company)} type="button">
                                <strong>{company.name}</strong>
                              </button>
                            </td>
                            <td>
                              {company.status ? (
                                <span className={`status ${company.status.cls}`}>{company.status.label}</span>
                              ) : (
                                <span className="td-muted">-</span>
                              )}
                            </td>
                            <td>{detail.om}</td>
                            <td>{detail.year}</td>
                            <td>{detail.courses.length}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td className="empty-state" colSpan={6}>
                          <strong>검색 결과가 없습니다.</strong>
                          <span>다른 기업명으로 검색해 보세요.</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function CompanyWikiDetail({ company, onBack }: { company: CompanyRow; onBack: () => void }) {
  const detail = getCompanyDetail(company.name);
  const status = company.status ?? { cls: "muted", label: "확인필요" };

  return (
    <>
      <button className="back-link" onClick={onBack} type="button">← 기업위키 목록으로</button>

      <div className="detail-header">
        <div className="title-row">
          <span className="title-company">기업위키</span>
          <h1>{company.name}</h1>
          <span className={`status ${status.cls}`}>{status.label}</span>
          <span className="sample-tag">예시 데이터</span>
        </div>
        <div className="detail-header-actions">
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
            <div className="info-item"><span>강의장</span><strong>{detail.venues.length}곳</strong></div>
            <div className="info-item"><span>정산 방식</span><strong>{detail.settlement}</strong></div>
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
        <div className="section-title"><h2>행정/정산</h2></div>
        <div className="section-body">
          <dl className="field-preview-list">
            <div>
              <dt>정산 프로세스</dt>
              <dd>
                {detail.settlementProcess.map((line, index) => (
                  <span key={index}>{line}<br /></span>
                ))}
              </dd>
            </div>
            <div>
              <dt>증빙 서류 패키지</dt>
              <dd>{detail.evidence}</dd>
            </div>
            <div>
              <dt>고객사 고유 양식</dt>
              <dd>{detail.customForm}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>담당자 운영 디테일</h2></div>
        <div className="section-body">
          <dl className="field-preview-list">
            <BulletField label="고객사 내부 배경" items={detail.background} />
            <BulletField label="선호하는 교육 방식" items={detail.preferredStyle} />
            <BulletField label="리텐션 필살기" items={detail.retention} />
            <BulletField label="강사 선호도" items={detail.instructorPref} />
          </dl>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>현장/인프라 정보</h2><span>{detail.venues.length}곳</span></div>
        <div className="section-body">
          {detail.venues.map((venue) => (
            <div className="venue-row" key={venue}>
              <strong>{venue}</strong>
              <span>상세 내용 미확보 (예시)</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function LinkPill({ on }: { on: boolean }) {
  return <span className={on ? "archive-pill done" : "archive-pill needed"}>{on ? "링크 보기" : "미등록"}</span>;
}

function BulletField({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}
