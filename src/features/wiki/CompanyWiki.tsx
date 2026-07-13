"use client";

import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";

interface CompanyStatus {
  cls: string;
  label: string;
}

interface CompanyRow {
  name: string;
  status?: CompanyStatus;
}

// 노션 기업위키 32건 기준. 상태가 알려진 건만 배지 표시, 나머지는 "-".
// 실데이터/DB 미연동 UI 미리보기이며 상세는 예시(삼성전기) 데이터다.
const COMPANIES: CompanyRow[] = [
  { name: "기업명_과정명", status: { cls: "muted", label: "템플릿" } },
  { name: "삼양식품_AI Agent 파일럿 과정" },
  { name: "어플라이드머티어리얼즈코리아_신입 엔지니어 대상 비즈니스 스피치 교육", status: { cls: "active", label: "운영중" } },
  { name: "유한킴벌리_AI&업무자동화 교육 프로그램", status: { cls: "active", label: "운영중" } },
  { name: "중앙홀딩스_CL 승격자 교육과정", status: { cls: "active", label: "운영중" } },
  { name: "HL만도" },
  { name: "롯데호텔앤리조트" },
  { name: "삼성전기", status: { cls: "active", label: "운영중" } },
  { name: "삼성전자", status: { cls: "active", label: "운영중" } },
  { name: "KT" },
  { name: "(참고) 과정별", status: { cls: "muted", label: "참고문서" } },
  { name: "중앙홀딩스_26년 CL승격자 교육과정" },
  { name: "KT_AI_Academy_Agent 개발 심화" },
  { name: "KT_AI_Academy_AID", status: { cls: "needs-assignment", label: "중단" } },
  { name: "현대자동차 AI Agent 업무자동화 과정" },
  { name: "동국제강그룹" },
  { name: "한화인재경영원" },
  { name: "홈앤서비스_AI 활용 DT 전문가 양성 과정" },
  { name: "홈앤서비스_2026 AI 교육" },
  { name: "LG경영연구원_단계별 생성형 AI 교육" },
  { name: "오스테오닉" },
  { name: "CJONS_IT 직군 역량 강화 교육" },
  { name: "CJONS_AX Champion(AI 아이디어 도출 워크숍)" },
  { name: "롯데면세점_생성형 AI 기반 마케팅 실무 역량 강화" },
  { name: "HD한국조선해양" },
  { name: "CJ ENM_THE AI ACADEMY (CREATOR)" },
  { name: "신한라이프_" },
  { name: "동국제약_역량별 생성형 AI 실무 활용 과정 및 싱글플랜" },
  { name: "두나무_AI 실무융합 마스터클래스" },
  { name: "머티어리얼즈코리아_과정명" },
  { name: "KT 26년 AX 교육" },
  { name: "현대건설" }
];

export function CompanyWiki() {
  const [selected, setSelected] = useState<null | string>(null);
  const [query, setQuery] = useState("");

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
          <CompanyWikiDetail companyName={selected} onBack={() => setSelected(null)} />
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
                        const isSamsungEM = company.name === "삼성전기";
                        return (
                          <tr key={company.name}>
                            <td>{index + 1}</td>
                            <td>
                              <button className="row-link" onClick={() => setSelected(company.name)} type="button">
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
                            <td>{isSamsungEM ? "이혜림" : "-"}</td>
                            <td>{isSamsungEM ? "2026" : "-"}</td>
                            <td>{isSamsungEM ? "2" : "-"}</td>
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

function CompanyWikiDetail({ companyName, onBack }: { companyName: string; onBack: () => void }) {
  return (
    <>
      <button className="back-link" onClick={onBack} type="button">← 기업위키 목록으로</button>

      <div className="detail-header">
        <div className="title-row">
          <span className="title-company">기업위키</span>
          <h1>{companyName}</h1>
          <span className="status active">운영중</span>
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
            <div className="info-item"><span>운영 담당자</span><strong>이혜림</strong></div>
            <div className="info-item"><span>운영년도</span><strong>2026</strong></div>
          </div>
        </div>
        <div className="detail-panel">
          <div className="panel-title">위키 요약</div>
          <div className="info-grid">
            <div className="info-item"><span>매핑 코스</span><strong>2건</strong></div>
            <div className="info-item"><span>담당자 정보</span><strong>3명</strong></div>
            <div className="info-item"><span>강의장</span><strong>3곳</strong></div>
            <div className="info-item"><span>정산 방식</span><strong>계산서 발행</strong></div>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>매핑 코스</h2><span>261060 · 261613 기준 2건</span></div>
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
              <tr>
                <td><strong>261060</strong></td>
                <td>AI 트렌드 특강</td>
                <td><span className="archive-pill done">링크 보기</span></td>
                <td><span className="archive-pill done">링크 보기</span></td>
                <td><span className="archive-pill done">링크 보기</span></td>
                <td><span className="archive-pill done">링크 보기</span></td>
              </tr>
              <tr>
                <td><strong>261613</strong></td>
                <td>AI 중급 활용 오프라인 과정</td>
                <td><span className="archive-pill done">링크 보기</span></td>
                <td><span className="archive-pill done">링크 보기</span></td>
                <td><span className="archive-pill done">링크 보기</span></td>
                <td><span className="archive-pill needed">미등록</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>담당자 정보</h2><span>3명</span></div>
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
              <tr>
                <td><strong>이◯민(수원)</strong></td>
                <td><span className="role-tag">프로(파트장)</span></td>
                <td>ha***4u.lee@day1company.co.kr</td>
                <td>010-****-1714</td>
                <td>OM의 밀착 관리 좋아함 (1:1과외 수준)</td>
                <td>처음~끝까지 모든 내용 공유 선호</td>
              </tr>
              <tr>
                <td><strong>이◯영(부산)</strong></td>
                <td><span className="role-tag">프로(파트장)</span></td>
                <td>ho***18.lee@day1company.co.kr</td>
                <td>010-****-8750</td>
                <td>-</td>
                <td>-</td>
              </tr>
              <tr>
                <td><strong>김◯선(세종)</strong></td>
                <td><span className="role-tag">프로</span></td>
                <td>yo***96.kim@day1company.co.kr</td>
                <td>010-****-5892</td>
                <td>-</td>
                <td>-</td>
              </tr>
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
                1. 계산서 발행<br />
                &nbsp;&nbsp;1) 발행을 위한 내용 확인 요청 (to 교담자)<br />
                &nbsp;&nbsp;2) 계산서 발행 요청 구글폼 작성 (업무 유관자 심◯희님)<br /><br />
                2. 상생협력법 약정서 날인<br />
                &nbsp;&nbsp;1) 고객사에서 보내준 상생협력법 약정서 확인 후 인감 도장 날인 결재 상신<br />
                &nbsp;&nbsp;2) 결재 후 인감 도장 날인 요청 (to 사업지원실) &gt; 슬랙 공지 참고<br />
                &nbsp;&nbsp;* 방문 날인 운영 시간 : 오전 10:00 ~ 11:00 / 오후 13:30 ~ 15:00
              </dd>
            </div>
            <div>
              <dt>증빙 서류 패키지</dt>
              <dd>전달 완료 (데이원 컴퍼니 사업자 등록증, 통장 사본)</dd>
            </div>
            <div>
              <dt>고객사 고유 양식</dt>
              <dd>없음 (필요 시, 고객사에서 요청 줌)</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>담당자 운영 디테일</h2></div>
        <div className="section-body">
          <dl className="field-preview-list">
            <div>
              <dt>고객사 내부 배경</dt>
              <dd>
                <ul>
                  <li>
                    사내에서 AX를 강하게 드라이브 걸고 있고, AI 공모전 진행 중
                    <ul><li>1분기 아이디어 제출, 2분기 활용 사례 발표, 3분기 아이디어 제출, 4분기 활용 사례 발표</li></ul>
                  </li>
                  <li>AI 특강을 확대하고자 하는 니즈 강함 → 사업 확장성이 큼 (AI 트렌드 특강 외에 추후 직무별 AI 교육 진행 예정)</li>
                </ul>
              </dd>
            </div>
            <div>
              <dt>선호하는 교육 방식</dt>
              <dd>
                <ul>
                  <li>실습 비율 80% 이상으로 구성 추구</li>
                  <li>업무 실사례 공유 니즈 강하심</li>
                </ul>
              </dd>
            </div>
            <div>
              <dt>리텐션 필살기</dt>
              <dd>
                <ul>
                  <li>밀착 관리 (LD/OM 나눌 것 없이 둘 다!)</li>
                  <li>아이디어 말씀드리고, 의견 드리는 것 매우 좋아하심</li>
                  <li>특히 현장에 오전 일찍 가서 모두 챙겨드리는 것 매우 좋아하심</li>
                </ul>
              </dd>
            </div>
            <div>
              <dt>강사 선호도</dt>
              <dd>
                <ul>
                  <li>딜리버리 능력 좋은 분 선호</li>
                  <li>플립러닝의 경우 온라인 강사가 오프라인 실습에 오시는 것 선호</li>
                </ul>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h2>현장/인프라 정보</h2><span>3곳</span></div>
        <div className="section-body">
          <div className="venue-row"><strong>{companyName} 수원 강의장</strong><span>상세 내용 미확보 (예시)</span></div>
          <div className="venue-row"><strong>{companyName} 세종 강의장</strong><span>상세 내용 미확보 (예시)</span></div>
          <div className="venue-row"><strong>{companyName} 부산 강의장</strong><span>상세 내용 미확보 (예시)</span></div>
        </div>
      </div>
    </>
  );
}
