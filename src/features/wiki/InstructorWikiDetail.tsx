import Link from "next/link";
import { Fragment } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { MaskedField } from "@/features/coaches/MaskedField";
import { PeopleFlagPill } from "@/features/people/PeopleDirectory";
import {
  PeopleCard,
  PeopleCollapsible,
  PeopleDetailBody,
  PeopleDetailHeader,
  PeopleFacts,
  PeoplePinned,
  PeopleStatusPill
} from "@/features/people/PeopleProfile";
import { coachActivityPolicy, seoulTodayKey } from "@/lib/coaches/coachActivity";
import { averageOf, formatPeopleDate, parseSatisfaction, peopleStatusFromFacts } from "@/lib/people/peopleStatus";
import {
  cleanCourseName,
  formatDateLabel,
  groupInstructorCourses,
  ROLE_CLASS,
  STATUS_LABEL,
  type InstructorWikiEntry
} from "./instructorWikiModel";
import { InstructorEditor } from "./InstructorEditor";
import { buildSurveyCommentDigest, commentsByCourseGroup, type RoundSurveyComment } from "./instructorSurveyComments";
import type { SessionSurveyResult } from "@/lib/data/sessionSurveyResultTypes";
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

// 강사 위키 상세. 코치 위키와 같은 틀(헤더 → 고정 알림 → 본문 2단)을 쓴다.
// "강사 위키 = 보는 곳 / 운영현황 = 하는 곳" 원칙이라 계약 '요청' 버튼은 두지 않는다.
// 아직 허브에 값이 없는 칸(계약 유형·신규강사 증빙 등)은 빈 틀로 늘어놓지 않고, 데이터가 생기면 해당 칸에 붙인다.
export async function InstructorWikiDetail({
  entry,
  surveyResults = []
}: {
  entry: InstructorWikiEntry;
  /** 회차별 만족도 결과(수강생 코멘트). 읽지 못하면 빈 목록 — 코멘트 칸만 비고 화면은 열린다. */
  surveyResults?: readonly SessionSurveyResult[];
}) {
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
    ? "코치 DB 매칭됨"
    : np?.syncedAt
      ? `노션 강사 DB · ${np.syncedAt.slice(0, 10)} 기준`
      : "노션 미연결";
  const baseFeeText = typeof np?.baseFee === "number" ? `${np.baseFee.toLocaleString("ko-KR")}원` : "";

  // 상태·지표는 운영 현황(courses)에서 바로 계산한다(별도 백엔드 불필요).
  const today = seoulTodayKey();
  // 진행·예정은 날짜로만 판단한다. 운영현황 진행상태는 지난 회차가 "배정필요"로 남아 있는 경우가 많아 믿을 수 없다.
  const status = peopleStatusFromFacts(
    entry.courses.map((course) => ({ startDate: course.startDate, endDate: course.endDate })),
    today,
    coachActivityPolicy.dormantMonths
  );
  const courseScores = entry.courses
    .map((course) => parseSatisfaction(course.avgSatisfaction))
    .filter((score): score is number => score !== null);
  const courseSatisfaction = averageOf(courseScores);
  const instructorScores = entry.courses
    .map((course) => parseSatisfaction(course.instructorSatisfaction))
    .filter((score): score is number => score !== null);
  const instructorSatisfaction = averageOf(instructorScores);
  const pastCourses = entry.courses.filter((course) => course.startDate && course.startDate <= today);
  const latest = pastCourses[0]?.startDate ?? "";
  const bookedCourses = entry.courses
    .filter((course) => course.startDate && (course.endDate || course.startDate) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const nextCourse = bookedCourses.find((course) => course.startDate >= today);
  const courseGroups = groupInstructorCourses(entry.courses);
  const commentDigest = buildSurveyCommentDigest(entry.courses, surveyResults);
  const groupComments = commentsByCourseGroup(entry.courses, surveyResults);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Instructor Wiki" teamScope="both" />

      <section className="content people-detail">
        <PeopleDetailHeader
          actions={
            notionUrl ? (
              <a className="notion-chip" href={notionUrl} target="_blank" rel="noreferrer">🔗 노션 원본 ↗</a>
            ) : (
              <span className="notion-chip is-off">노션 미연결</span>
            )
          }
          avatarName={entry.name}
          backHref="/instructor-wiki"
          backLabel="강사 위키"
          badges={
            <>
              <PeopleStatusPill status={status} />
              {np?.recruitAvoid ? <PeopleFlagPill flag={{ label: "⛔ 섭외지양", tone: "bad" }} /> : null}
            </>
          }
          fields={fields}
          kpis={[
            { label: "투입", value: `${entry.courseCount}건` },
            { label: "최근 투입", value: latest ? formatPeopleDate(latest, today) : "-" },
            {
              label: "만족도",
              value: (
                <>
                  종합 {courseSatisfaction !== null ? courseSatisfaction.toFixed(1) : "-"} · 강사 {instructorSatisfaction !== null ? instructorSatisfaction.toFixed(1) : "-"}
                </>
              )
            },
            { label: "다음 예정", value: nextCourse ? formatPeopleDate(nextCourse.startDate, today) : "-" }
          ]}
          title={<NameEditor name={entry.name} initialName={displayName} />}
        />

        <PeoplePinned
          items={
            np?.recruitAvoid
              ? [{ key: "recruit-avoid", text: "섭외지양 강사입니다. 노션 강사 DB의 \"섭외지양 여부\" 값이에요.", tone: "bad" }]
              : []
          }
        />

        <PeopleDetailBody
          main={
            <>
              <SurveyCommentCard digest={commentDigest} />

              <PeopleCard note={profileSource} title="소개 · 전문분야">
                <PeopleFacts
                  items={[
                    { label: "소속", value: np?.affiliation },
                    { label: "전문분야", value: fields.join(" · ") },
                    { label: "가능 커리큘럼", value: curriculums.join(", ") },
                    {
                      label: "자료",
                      value: (
                        <>
                          {np?.demoCheckUrl ? (
                            <a className="notion-chip" href={np.demoCheckUrl} target="_blank" rel="noreferrer">시범강의 점검표 ↗</a>
                          ) : null}
                          <ProfileAttachments />
                        </>
                      )
                    }
                  ]}
                />
                <p className="field-hint">노션 강사 DB에서 자동으로 가져온 값이에요. 원본은 노션에서 수정해 주세요.</p>
              </PeopleCard>

              <InstructorEditor name={entry.name} initial={note} notion={np} />

              {/* 투입 이력은 길고 가끔 보는 내용이라 맨 아래에 접어 둔다. 같은 과정의 회차는 한 줄로 묶는다. */}
              <PeopleCollapsible
                id="history"
                note={`과정 ${courseGroups.length}개 · 회차 ${entry.courseCount}건 · 운영 현황 자동`}
                title="투입 이력"
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>기업</th>
                        <th>과정명</th>
                        <th>역할</th>
                        <th>종합만족도</th>
                        <th>강사만족도</th>
                        <th>최초 투입</th>
                        <th>담당 OM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {courseGroups.length > 0 ? (
                        courseGroups.map((group) => (
                          <Fragment key={group.key}>
                          <tr>
                            <td><strong className="title-company">{group.companyName}</strong></td>
                            <td>
                              <a className="course-link" href={`/operations/${group.operationId}`} rel="noreferrer" target="_blank">
                                {cleanCourseName(group.courseName)} ↗
                              </a>
                              {group.roundCount > 1 ? <span className="td-muted"> {group.roundCount}회차</span> : null}
                              {group.instructorWikiLink ? (
                                <>
                                  {" "}
                                  <a className="archive-pill done" href={group.instructorWikiLink} rel="noreferrer" target="_blank">위키↗</a>
                                </>
                              ) : null}
                            </td>
                            <td>
                              {group.roles.map((role) => (
                                <span className={`status ${ROLE_CLASS[role]}`} key={role} style={{ marginRight: 4 }}>{role}</span>
                              ))}
                            </td>
                            <td>{group.courseSatisfaction !== null ? group.courseSatisfaction.toFixed(1) : <span className="td-muted">-</span>}</td>
                            <td>{group.instructorSatisfaction !== null ? group.instructorSatisfaction.toFixed(1) : <span className="td-muted">-</span>}</td>
                            <td>{group.firstDate ? formatDateLabel(group.firstDate) : <span className="td-muted">-</span>}</td>
                            <td>{group.oms.length > 0 ? group.oms.join(", ") : <span className="td-muted">-</span>}</td>
                          </tr>
                          {groupComments.has(group.key) ? (
                            <tr className="survey-comment-row">
                              <td colSpan={7}>
                                <RoundCommentList rounds={groupComments.get(group.key)!} />
                              </td>
                            </tr>
                          ) : null}
                          </Fragment>
                        ))
                      ) : (
                        <tr>
                          <td className="empty-state" colSpan={7}>
                            <strong>투입 이력이 없습니다.</strong>
                            <span>운영 현황에 이 강사가 배정되면 표시됩니다.</span>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </PeopleCollapsible>
            </>
          }
          side={
            <>
              <PeopleCard note="운영 현황 자동" title="가용성">
                {bookedCourses.length > 0 ? (
                  <ul className="people-plain-list">
                    {bookedCourses.slice(0, 5).map((course, index) => (
                      <li key={`${course.operationId}-${index}`}>
                        <strong>{formatPeopleDate(course.startDate, today)}</strong> {course.companyName} · {cleanCourseName(course.courseName)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="td-muted">진행·예정 과정이 없어요.</p>
                )}
              </PeopleCard>

              <PeopleCard note="요청은 운영현황에서" title="조건">
                <PeopleFacts
                  items={[
                    { label: "기본 강사료", value: baseFeeText },
                    { label: "특이사항", value: np?.feeNote ? <span className="wiki-view">{np.feeNote}</span> : "" }
                  ]}
                />
              </PeopleCard>

              <PeopleCard note="열람 기록 남음" title="개인정보">
                {note.id ? (
                  <div className="people-contact">
                    <MaskedField entity="instructor" id={note.id} field="contact" label="연락처" />
                    <MaskedField entity="instructor" id={note.id} field="email" label="이메일" />
                  </div>
                ) : (
                  <p className="td-muted">노션에 연결되면 열람할 수 있어요.</p>
                )}
              </PeopleCard>

              <PeopleCard title="관리">
                <PeopleFacts
                  items={[
                    { label: "정보 출처", value: profileSource },
                    {
                      label: "코치 DB",
                      value: coach ? (
                        <Link href={`/coaches/${coach.coachId}`}>{STATUS_LABEL[coach.status]} · 코치 위키 보기 →</Link>
                      ) : ""
                    }
                  ]}
                />
                {/* 운영 현황 표기가 노션과 달라 프로필이 안 붙는 경우, OM이 여기서 한 번 연결한다. */}
                <NotionLinkEditor
                  isNotionEntry={isNotionEntry}
                  linkedAliases={linkedAliases}
                  name={entry.name}
                  notionNames={notionNames}
                />
              </PeopleCard>
            </>
          }
        />
      </section>
    </main>
  );
}

// 상단 "수강생 코멘트" 카드: 요약이 있는 최근 과정에서 강점·개선을 모아 보여 준다.
// 주관식 없는 설문은 정상이라 미완성으로 보이지 않게 안내만 한다.
function SurveyCommentCard({ digest }: { digest: ReturnType<typeof buildSurveyCommentDigest> }) {
  const { counts, lines, courseCount } = digest;
  const total = counts.ok + counts.no_subjective + counts.no_summary;
  const note = total === 0
    ? "만족도 반영 때 자동"
    : [
        courseCount > 0 ? `최근 과정 ${courseCount}개` : null,
        counts.ok > 0 ? `요약 있음 ${counts.ok}` : null,
        counts.no_subjective > 0 ? `주관식 없음 ${counts.no_subjective}` : null,
        counts.no_summary > 0 ? `요약 없이 반영 ${counts.no_summary}` : null
      ].filter(Boolean).join(" · ");
  const positive = lines.filter((line) => line.kind === "positive");
  const improve = lines.filter((line) => line.kind === "improve");
  return (
    <PeopleCard note={note} title="수강생 코멘트">
      {lines.length > 0 ? (
        <dl className="survey-comment-digest">
          {positive.length > 0 ? (
            <div>
              <dt>👍 강점</dt>
              <dd>
                <ul>{positive.map((line, index) => <li key={index}>{line.text} <span className="people-chip">{line.source}</span></li>)}</ul>
              </dd>
            </div>
          ) : null}
          {improve.length > 0 ? (
            <div>
              <dt>🔧 개선</dt>
              <dd>
                <ul>{improve.map((line, index) => <li key={index}>{line.text} <span className="people-chip">{line.source}</span></li>)}</ul>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="field-hint">
          {total === 0
            ? "아직 반영된 코멘트가 없어요. OM이 survey_analysis에서 [hub-om 반영]을 누르면 채워져요."
            : counts.no_subjective > 0 && counts.ok === 0 && counts.no_summary === 0
              ? "반영된 설문이 모두 주관식 문항이 없는 설문이에요."
              : "요약이 있는 과정이 아직 없어요. 담당 OM이 AI 요약을 만든 뒤 다시 반영하면 채워져요."}
        </p>
      )}
      {lines.length > 0 ? <p className="field-hint">과정마다 최대 2줄씩, 최근 순이에요. 전체는 아래 투입 이력에서 볼 수 있어요.</p> : null}
    </PeopleCard>
  );
}

// 투입 이력의 과정 한 줄 아래 붙는 회차별 코멘트.
function RoundCommentList({ rounds }: { rounds: RoundSurveyComment[] }) {
  return (
    <ul className="survey-comment-rounds">
      {rounds.map((round) => {
        const label = rounds.length > 1 ? `${round.roundNo || formatDateLabel(round.startDate)}` : null;
        const measured = [
          round.respondents !== null ? `응답 ${round.respondents}명` : null,
          round.positiveRate ? `긍정 ${round.positiveRate}%` : null
        ].filter(Boolean).join(" · ");
        return (
          <li key={round.operationId}>
            {label || measured ? (
              <span className="survey-comment-meta">{[label, measured].filter(Boolean).join(" · ")}</span>
            ) : null}
            {round.status === "no_subjective" ? (
              <span className="people-status people-status--dormant">주관식 없는 설문</span>
            ) : round.status === "no_summary" ? (
              <>
                <span className="people-flag people-flag--warn">요약 없이 반영</span>{" "}
                <span className="td-muted">담당 OM이 다시 반영하면 채워져요</span>
              </>
            ) : round.positive.length + round.improve.length === 0 ? (
              <span className="td-muted">요약에 남길 의견이 없었어요</span>
            ) : (
              <>
                {round.positive.length > 0 ? <p>👍 {round.positive.join(" · ")}</p> : null}
                {round.improve.length > 0 ? <p>🔧 {round.improve.join(" · ")}</p> : null}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
