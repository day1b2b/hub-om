import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import {
  cleanCourseName,
  formatDateLabel,
  OPERATION_STATUS_CLASS,
  ROLE_CLASS,
  roleSummary,
  STATUS_CLASS,
  STATUS_LABEL,
  type InstructorWikiEntry
} from "./instructorWikiModel";
import { WikiAvatar } from "./wikiAvatar";

export function InstructorWikiDetail({ entry }: { entry: InstructorWikiEntry }) {
  const coach = entry.coach;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Instructor Wiki" teamScope="both" />

      <section className="content">
        <Link className="back-link" href="/instructor-wiki">← 강사위키 목록으로</Link>

        <div className="detail-header">
          <div className="title-row">
            <WikiAvatar name={entry.name} size="lg" />
            <span className="title-company">강사위키</span>
            <h1>{entry.name}</h1>
            <span className="coach-plan-badge">운영 현황 연동</span>
            {roleSummary(entry).map((role) => (
              <span className={`status ${ROLE_CLASS[role]}`} key={role}>{role}</span>
            ))}
            {coach ? (
              <span className={`status ${STATUS_CLASS[coach.status]}`}>coach-db · {STATUS_LABEL[coach.status]}</span>
            ) : null}
          </div>
          <div className="detail-header-actions">
            <button type="button">수정</button>
          </div>
        </div>

        <div className="detail-section">
          <div className="section-title"><h2>파트너 ID</h2><span>강사 식별자 · 입력</span></div>
          <div className="section-body">
            <div className="partner-id-field">
              <input className="partner-id-input" placeholder="파트너ID 입력 (예: PT-00123)" aria-label="파트너 ID" />
              <button className="doc-register" type="button">저장</button>
            </div>
            <p className="field-hint">입력 미리보기예요. 데이터 연동 시 강사별 파트너ID가 자동 표시·저장됩니다.</p>
          </div>
        </div>

        <div className="detail-grid">
          <div className="detail-panel">
            <div className="panel-title">운영 요약</div>
            <div className="info-grid">
              <div className="info-item"><span>담당 기업</span><strong>{entry.companies.length}곳</strong></div>
              <div className="info-item"><span>담당 코스</span><strong>{entry.courseCount}건</strong></div>
              <div className="info-item"><span>역할</span><strong>{roleSummary(entry).join(" · ") || "-"}</strong></div>
              <div className="info-item"><span>평균 평가(coach)</span><strong>{coach?.avgRating != null ? coach.avgRating.toFixed(1) : "-"}</strong></div>
            </div>
          </div>
          <div className="detail-panel">
            <div className="panel-title">담당 기업</div>
            <div className="section-body" style={{ padding: 0 }}>
              {entry.companies.length > 0 ? (
                <div className="field-preview-list">
                  <div>
                    <dd style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {entry.companies.map((company) => (
                        <span className="role-tag" key={company}>{company}</span>
                      ))}
                    </dd>
                  </div>
                </div>
              ) : (
                <span className="td-muted">담당 기업 정보가 없습니다.</span>
              )}
            </div>
          </div>
        </div>

        <div className="detail-section">
          <div className="section-title"><h2>담당 코스 · 운영 현황</h2><span>{entry.courseCount}건</span></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>기업</th>
                  <th>과정명</th>
                  <th>역할</th>
                  <th>차수</th>
                  <th>상태</th>
                  <th>기간</th>
                  <th>강사 만족도</th>
                  <th>담당 OM</th>
                </tr>
              </thead>
              <tbody>
                {entry.courses.length > 0 ? (
                  entry.courses.map((course, index) => (
                    <tr key={`${course.operationId}-${course.role}-${index}`}>
                      <td><strong className="title-company">{course.companyName}</strong></td>
                      <td>
                        {cleanCourseName(course.courseName)}
                        {course.instructorWikiLink ? (
                          <>
                            {" "}
                            <a className="archive-pill done" href={course.instructorWikiLink} rel="noreferrer" target="_blank">위키↗</a>
                          </>
                        ) : null}
                      </td>
                      <td><span className={`status ${ROLE_CLASS[course.role]}`}>{course.role}</span></td>
                      <td>{course.roundNo || <span className="td-muted">-</span>}</td>
                      <td>
                        <span className={`status ${OPERATION_STATUS_CLASS[course.status] ?? "muted"}`}>{course.status}</span>
                      </td>
                      <td>
                        {course.startDate ? formatDateLabel(course.startDate) : "-"}
                        {course.endDate && course.endDate !== course.startDate ? ` ~ ${formatDateLabel(course.endDate)}` : ""}
                      </td>
                      <td>{course.instructorSatisfaction ? course.instructorSatisfaction : <span className="td-muted">-</span>}</td>
                      <td>{course.om || <span className="td-muted">-</span>}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={8}>
                      <strong>담당 코스가 없습니다.</strong>
                      <span>운영 현황에 이 강사가 배정되면 표시됩니다.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="detail-section">
          <div className="section-title">
            <h2>강사 프로필 (coach-db)</h2>
            <span>{coach ? "강사 DB 매칭됨" : "미연결 · 미매칭"}</span>
          </div>
          <div className="section-body">
            <dl className="field-preview-list">
              <div>
                <dt>전문분야</dt>
                <dd>{coach && coach.fields.length > 0 ? coach.fields.join(" · ") : "coach-db 연결 시 표시"}</dd>
              </div>
              <div>
                <dt>근무유형</dt>
                <dd>{coach?.workType || "coach-db 연결 시 표시"}</dd>
              </div>
              <div>
                <dt>가능 커리큘럼</dt>
                <dd>
                  {coach && coach.curriculums.length > 0 ? (
                    <ul>
                      {coach.curriculums.map((curriculum) => (
                        <li key={curriculum}>{curriculum}</li>
                      ))}
                    </ul>
                  ) : (
                    "coach-db 연결 시 표시"
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="detail-section">
          <div className="section-title"><h2>계약 / 정산</h2><span>PII · 위키 미연동</span></div>
          <div className="section-body">
            <dl className="field-preview-list">
              <div>
                <dt>연락처 · 이메일</dt>
                <dd><span className="td-muted">개인정보 · 코치 상세(PII 권한)에서 확인</span></dd>
              </div>
              <div>
                <dt>소속 · 사업자</dt>
                <dd><span className="td-muted">개인정보 · 코치 상세(PII 권한)에서 확인</span></dd>
              </div>
              <div>
                <dt>정산 계좌 · 강사료</dt>
                <dd><span className="td-muted">개인정보 · 코치 상세(PII 권한)에서 확인</span></dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </main>
  );
}
