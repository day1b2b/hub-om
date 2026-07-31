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
import { RecruitAvoidToggle } from "./RecruitAvoidToggle";
import { InstructorEditor } from "./InstructorEditor";
import { ProfileAttachments } from "./ProfileAttachments";
import { NameEditor } from "./NameEditor";
import { getInstructorNote } from "@/lib/data/instructorWikiStore";

export function InstructorWikiDetail({ entry }: { entry: InstructorWikiEntry }) {
  const coach = entry.coach;
  const note = getInstructorNote(entry.name);
  const displayName = note.displayName?.trim() || entry.name;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Instructor Wiki" teamScope="both" />

      <section className="content">
        <Link className="back-link" href="/instructor-wiki">← 강사위키 목록으로</Link>

        <div className="detail-header">
          <div className="title-row">
            <WikiAvatar name={entry.name} size="lg" />
            <span className="title-company">강사위키</span>
            <NameEditor name={entry.name} initialName={displayName} />
            <RecruitAvoidToggle name={entry.name} initialAvoid={note.recruitAvoid ?? false} />
            <span className="coach-plan-badge">운영 현황 연동</span>
            {roleSummary(entry).map((role) => (
              <span className={`status ${ROLE_CLASS[role]}`} key={role}>{role}</span>
            ))}
            {coach ? (
              <span className={`status ${STATUS_CLASS[coach.status]}`}>coach-db · {STATUS_LABEL[coach.status]}</span>
            ) : null}
          </div>
        </div>

        <InstructorEditor name={entry.name} initial={note} />

        <div className="detail-section">
          <div className="section-title">
            <h2>강사 프로필</h2>
            <span>{coach ? "강사 DB 매칭됨" : "미연결 · 미매칭"}</span>
          </div>
          <div className="section-body">
            <dl className="field-preview-list">
              <div>
                <dt>전문분야</dt>
                <dd>{coach && coach.fields.length > 0 ? coach.fields.join(" · ") : <span className="td-muted">-</span>}</dd>
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
                    <span className="td-muted">-</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>첨부 파일</dt>
                <dd><ProfileAttachments /></dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="detail-grid">
          <div className="detail-panel detail-panel--full">
            <div className="panel-title">운영 요약</div>
            <div className="info-grid info-grid--row">
              <div className="info-item"><span>담당 코스</span><strong>{entry.courseCount}건</strong></div>
              <div className="info-item"><span>역할</span><strong>{roleSummary(entry).join(" · ") || "-"}</strong></div>
              <div className="info-item"><span>평균 평가(coach)</span><strong>{coach?.avgRating != null ? coach.avgRating.toFixed(1) : "-"}</strong></div>
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

      </section>
    </main>
  );
}
