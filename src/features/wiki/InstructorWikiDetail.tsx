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
import { getInstructorNote, notionHref } from "@/lib/data/instructorWikiStore";

export function InstructorWikiDetail({ entry }: { entry: InstructorWikiEntry }) {
  const coach = entry.coach;
  const note = getInstructorNote(entry.name);
  const displayName = note.displayName?.trim() || entry.name;
  const notionUrl = notionHref(note.notionId);

  // 강사 프로필은 coach-db가 우선이고, 없으면 노션 강사 DB 스냅샷으로 채운다.
  const np = note.notion;
  const fields = coach && coach.fields.length > 0 ? coach.fields : np?.categories ?? [];
  const curriculums = coach && coach.curriculums.length > 0 ? coach.curriculums : np?.lectureTopics ?? [];
  const profileSource = coach
    ? "강사 DB 매칭됨"
    : np?.syncedAt
      ? `노션 강사 DB · ${np.syncedAt.slice(0, 10)} 기준`
      : "미연결 · 미매칭";
  const baseFeeText = typeof np?.baseFee === "number" ? `${np.baseFee.toLocaleString("ko-KR")}원` : "";

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
            {/* 노션 강사 페이지 이동. 목록에서 바로 넘어가지 않고 여기서만 연다. */}
            {notionUrl ? (
              <a className="notion-chip" href={notionUrl} target="_blank" rel="noreferrer">🔗 노션 강사 페이지 ↗</a>
            ) : (
              <span className="notion-chip is-off">노션 미연결</span>
            )}
            <RecruitAvoidToggle name={entry.name} initialAvoid={note.recruitAvoid ?? false} />
            {/* 노션 쪽에만 섭외지양이 걸린 경우. OM 토글을 덮지 않고 별도로 알려준다. */}
            {np?.recruitAvoid && !note.recruitAvoid ? (
              <span className="recruit-avoid-badge">⛔ 노션: 섭외지양</span>
            ) : null}
            <span className="coach-plan-badge">운영 현황 연동</span>
            {roleSummary(entry).map((role) => (
              <span className={`status ${ROLE_CLASS[role]}`} key={role}>{role}</span>
            ))}
            {coach ? (
              <span className={`status ${STATUS_CLASS[coach.status]}`}>coach-db · {STATUS_LABEL[coach.status]}</span>
            ) : null}
          </div>
        </div>

        <InstructorEditor name={entry.name} initial={note} notion={np} />

        <div className="detail-section">
          <div className="section-title">
            <h2>강사 프로필</h2>
            <span>{profileSource}</span>
          </div>
          <div className="section-body">
            <dl className="field-preview-list">
              <div>
                <dt>소속</dt>
                <dd>{np?.affiliation ? np.affiliation : <span className="td-muted">-</span>}</dd>
              </div>
              <div>
                <dt>전문분야</dt>
                <dd>{fields.length > 0 ? fields.join(" · ") : <span className="td-muted">-</span>}</dd>
              </div>
              <div>
                <dt>가능 커리큘럼</dt>
                <dd>
                  {curriculums.length > 0 ? (
                    <ul>
                      {curriculums.map((curriculum) => (
                        <li key={curriculum}>{curriculum}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="td-muted">-</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>기본 강사료</dt>
                <dd>{baseFeeText ? baseFeeText : <span className="td-muted">-</span>}</dd>
              </div>
              <div>
                <dt>강사료 특이사항</dt>
                <dd>{np?.feeNote ? <span className="wiki-view">{np.feeNote}</span> : <span className="td-muted">-</span>}</dd>
              </div>
              <div>
                <dt>생년월일</dt>
                <dd>{np?.birthDate ? np.birthDate : <span className="td-muted">-</span>}</dd>
              </div>
              {/* 노션 메모는 위 「강사 정보 · 강사 특이사항」에서 보여주므로 여기서는 중복 표시하지 않는다. */}
              <div>
                <dt>시범강의 점검표</dt>
                <dd>
                  {np?.demoCheckUrl ? (
                    <a className="notion-chip" href={np.demoCheckUrl} target="_blank" rel="noreferrer">점검표 열기 ↗</a>
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
            <p className="field-hint">
              소속·전문분야·강사료·생년월일은 노션 강사 DB에서 자동으로 가져온 값이에요. 여기서 고쳐도 노션에는 반영되지 않으니 원본은 노션에서 수정해 주세요.
            </p>
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
