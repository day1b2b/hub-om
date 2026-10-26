import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import {
  cleanCourseName,
  formatDateLabel,
  hasActiveCourse,
  OPERATION_STATUS_CLASS,
  ROLE_CLASS,
  roleSummary,
  STATUS_CLASS,
  STATUS_LABEL,
  type InstructorWikiEntry
} from "./instructorWikiModel";
import { WikiAvatar } from "./wikiAvatar";
import { InstructorEditor } from "./InstructorEditor";
import { ProfileAttachments } from "./ProfileAttachments";
import { NameEditor } from "./NameEditor";
import { NotionLinkEditor } from "./NotionLinkEditor";
import {
  getInstructorNote,
  getInstructorNoteByNotionNo,
  listInstructorNotes,
  notionHref,
  resolveNotionLinkTargets
} from "@/lib/data/instructorWikiStore";

// 강사위키 상세 = 강사 1명 360° 카드. 상단 요약 + 4버킷([섭외]기본정보·[계약/정산]·[회고]·[섭외]암묵지).
// "강사위키 = 보는 곳(정보) / 운영현황 = 하는 곳(처리)" 원칙 → 계약 '요청' 버튼은 두지 않는다.
// 암묵지 5분류(강점·유의사항·소통 스타일·강의 스타일·비고)는 노션 강사위키 양식과 동일하다.
// 1차는 기존 데이터를 버킷으로 재배치하고, 아직 허브에 없는 값은 "준비중" 틀로 둔다(데이터 로직 미변경).
const TACIT_CATEGORIES = ["강점", "유의사항", "소통 스타일", "강의 스타일", "비고"] as const;

export async function InstructorWikiDetail({ entry }: { entry: InstructorWikiEntry }) {
  const coach = entry.coach;
  // 노션 NO가 있으면 그것으로 읽는다(동명이인 구분). 없으면 운영 현황 표기라 이름으로 읽는다.
  const note =
    entry.notionNo !== undefined
      ? await getInstructorNoteByNotionNo(entry.notionNo)
      : await getInstructorNote(entry.name);
  const displayName = note.displayName?.trim() || entry.name;
  const notionUrl = notionHref(note.notionId);

  // 수동 연결용 노션 강사 명단. 이 항목이 노션 본체인지도 함께 판단한다.
  const allNotes = await listInstructorNotes();
  const notionNames = allNotes
    .filter((candidate) => candidate.notion)
    .map((candidate) => (candidate.instructorName ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ko"));
  const isNotionEntry = Boolean(note.notion);

  // 이 강사로 연결돼 있는 운영 현황 표기들(본체 화면에서 해제할 수 있게).
  const linkTargets = resolveNotionLinkTargets(allNotes);
  const linkedAliases = Object.keys(linkTargets)
    .filter((alias) => linkTargets[alias] === entry.name)
    .sort((a, b) => a.localeCompare(b, "ko"));

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

  // 요약·배정현황은 운영 현황(courses)에서 바로 계산한다(별도 백엔드 불필요).
  const activeNow = hasActiveCourse(entry);
  const latestAssignment = entry.courses[0]?.startDate ? formatDateLabel(entry.courses[0].startDate) : "-";
  const avgRatingText = coach?.avgRating != null ? coach.avgRating.toFixed(1) : "-";

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
            {/* 운영 현황 표기가 노션과 달라 프로필이 안 붙는 경우, OM이 여기서 한 번 연결한다. */}
            <NotionLinkEditor
              isNotionEntry={isNotionEntry}
              linkedAliases={linkedAliases}
              name={entry.name}
              notionNames={notionNames}
            />
            {/* 섭외지양은 노션 강사 DB의 "섭외지양 여부"만 보고 자동 표기한다. */}
            {np?.recruitAvoid ? <span className="recruit-avoid-badge">⛔ 섭외지양</span> : null}
            <span className="coach-plan-badge">운영 현황 연동</span>
            {roleSummary(entry).map((role) => (
              <span className={`status ${ROLE_CLASS[role]}`} key={role}>{role}</span>
            ))}
            {coach ? (
              <span className={`status ${STATUS_CLASS[coach.status]}`}>coach-db · {STATUS_LABEL[coach.status]}</span>
            ) : null}
          </div>
        </div>

        {/* 상단 요약 */}
        <div className="detail-grid">
          <div className="detail-panel detail-panel--full">
            <div className="panel-title">운영 요약</div>
            <div className="info-grid info-grid--row">
              <div className="info-item"><span>담당 코스</span><strong>{entry.courseCount}건</strong></div>
              <div className="info-item"><span>평균 평가(coach)</span><strong>{avgRatingText}</strong></div>
              <div className="info-item"><span>최근 배정</span><strong>{latestAssignment}</strong></div>
            </div>
          </div>
        </div>

        {/* 4버킷 — 상위 3개 요약(기본정보 · 계약/정산 · 회고) */}
        <div className="detail-grid iw-buckets">
          {/* [섭외] 기본정보 */}
          <div className="detail-section">
            <div className="section-title"><h2>[섭외] 기본정보</h2><span>{profileSource}</span></div>
            <div className="iw-bucket-body">
              <dl className="field-preview-list">
                <div><dt>소속</dt><dd>{np?.affiliation ? np.affiliation : <span className="td-muted">-</span>}</dd></div>
                <div><dt>전문분야</dt><dd>{fields.length > 0 ? fields.join(" · ") : <span className="td-muted">-</span>}</dd></div>
                <div><dt>가능 커리큘럼</dt><dd>{curriculums.length > 0 ? curriculums.join(", ") : <span className="td-muted">-</span>}</dd></div>
                <div>
                  <dt>이력서·포트폴리오</dt>
                  <dd>
                    {np?.demoCheckUrl ? (
                      <a className="notion-chip" href={np.demoCheckUrl} target="_blank" rel="noreferrer">시범강의 점검표 ↗</a>
                    ) : (
                      <span className="td-muted">-</span>
                    )}
                    <ProfileAttachments />
                  </dd>
                </div>
                <div>
                  <dt>배정 현황</dt>
                  <dd>{activeNow ? "진행·예정 있음" : "현재 배정 없음"} <span className="field-hint-inline">운영현황 자동</span></dd>
                </div>
              </dl>
              <p className="field-hint">소속·전문분야·강사료는 노션 강사 DB에서 자동으로 가져온 값이에요. 원본은 노션에서 수정해 주세요.</p>
            </div>
          </div>

          {/* [계약/정산] — 정보만, 요청 버튼은 운영현황에 둔다 */}
          <div className="detail-section">
            <div className="section-title"><h2>[계약/정산]</h2><span>정보만 · 요청은 운영현황</span></div>
            <div className="iw-bucket-body">
              <dl className="field-preview-list">
                <div><dt>기본 강사료</dt><dd>{baseFeeText ? baseFeeText : <span className="td-muted">-</span>}</dd></div>
                <div><dt>강사료 특이사항</dt><dd>{np?.feeNote ? <span className="wiki-view">{np.feeNote}</span> : <span className="td-muted">-</span>}</dd></div>
                <div><dt>계약 유형</dt><dd><span className="status soon">준비중</span></dd></div>
                <div><dt>신규강사 증빙</dt><dd><span className="status soon">준비중</span></dd></div>
              </dl>
            </div>
          </div>

          {/* [회고] — 요약(상세 표는 아래) */}
          <div className="detail-section">
            <div className="section-title"><h2>[회고]</h2><span>운영현황 자동</span></div>
            <div className="iw-bucket-body">
              <dl className="field-preview-list">
                <div><dt>교육 참여 이력</dt><dd>{entry.courseCount}건</dd></div>
                <div><dt>과정별 만족도</dt><dd>{avgRatingText !== "-" ? `${avgRatingText} (단일)` : <span className="td-muted">-</span>}</dd></div>
                <div><dt>종합·전문성·전달력 추세</dt><dd><span className="status soon">준비중</span></dd></div>
                <div><dt>매니저 정성평가</dt><dd><span className="status soon">준비중</span></dd></div>
              </dl>
            </div>
          </div>
        </div>

        {/* [섭외] 암묵지 — 강사위키의 핵심(전폭). 5분류는 노션 강사위키 양식과 동일. */}
        <div className="detail-section iw-tacit">
          <div className="section-title">
            <h2>[섭외] 암묵지</h2>
            <span>강사위키의 핵심 · OM이 쌓는 운영 지식</span>
          </div>
          <div className="iw-bucket-body">
            <InstructorEditor name={entry.name} initial={note} notion={np} />
            <div className="iw-recommend">
              <span className="iw-recommend-label">섭외 추천도</span>
              {np?.recruitAvoid ? <span className="status needs-assignment">⛔ 섭외지양</span> : <span className="status soon">준비중</span>}
            </div>
            <table className="iw-tacit-table">
              <tbody>
                {TACIT_CATEGORIES.map((category) => (
                  <tr key={category}>
                    <th scope="row">{category}</th>
                    <td><span className="status soon">준비중</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="field-hint">
              강점·유의사항·소통/강의 스타일·비고는 노션 강사위키 양식과 같아요. 지금은 틀만 있고, 실제 내용은 노션 강사위키에서 가져올 예정이에요(2차).
            </p>
          </div>
        </div>

        {/* [회고] 담당 코스 상세 */}
        <div className="detail-section">
          <div className="section-title"><h2>[회고] 담당 코스 · 운영 현황</h2><span>{entry.courseCount}건</span></div>
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
