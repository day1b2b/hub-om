import Link from "next/link";
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
  hasActiveCourse,
  ROLE_CLASS,
  STATUS_LABEL,
  type InstructorWikiEntry
} from "./instructorWikiModel";
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

// 강사 위키 상세. 코치 위키와 같은 틀(헤더 → 고정 알림 → 본문 2단)을 쓴다.
// "강사 위키 = 보는 곳 / 운영현황 = 하는 곳" 원칙이라 계약 '요청' 버튼은 두지 않는다.
// 아직 허브에 값이 없는 칸(계약 유형·신규강사 증빙 등)은 빈 틀로 늘어놓지 않고, 데이터가 생기면 해당 칸에 붙인다.
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
    ? "코치 DB 매칭됨"
    : np?.syncedAt
      ? `노션 강사 DB · ${np.syncedAt.slice(0, 10)} 기준`
      : "노션 미연결";
  const baseFeeText = typeof np?.baseFee === "number" ? `${np.baseFee.toLocaleString("ko-KR")}원` : "";

  // 상태·지표는 운영 현황(courses)에서 바로 계산한다(별도 백엔드 불필요).
  const today = seoulTodayKey();
  const status = peopleStatusFromFacts(
    entry.courses.map((course) => ({ startDate: course.startDate, endDate: course.endDate })),
    today,
    coachActivityPolicy.dormantMonths,
    hasActiveCourse(entry)
  );
  const scores = entry.courses
    .map((course) => parseSatisfaction(course.instructorSatisfaction))
    .filter((score): score is number => score !== null);
  const satisfaction = averageOf(scores);
  const pastCourses = entry.courses.filter((course) => course.startDate && course.startDate <= today);
  const latest = pastCourses[0]?.startDate ?? "";
  const bookedCourses = entry.courses
    .filter((course) => course.startDate && (course.endDate || course.startDate) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const nextCourse = bookedCourses.find((course) => course.startDate >= today);
  const courseGroups = groupInstructorCourses(entry.courses);

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
            { label: "만족도", value: satisfaction !== null ? <>{satisfaction.toFixed(1)} <small>{scores.length}건</small></> : "-" },
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
                        <th>만족도</th>
                        <th>최초 투입</th>
                        <th>담당 OM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {courseGroups.length > 0 ? (
                        courseGroups.map((group) => (
                          <tr key={group.key}>
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
                            <td>{group.satisfaction !== null ? group.satisfaction.toFixed(1) : <span className="td-muted">-</span>}</td>
                            <td>{group.firstDate ? formatDateLabel(group.firstDate) : <span className="td-muted">-</span>}</td>
                            <td>{group.oms.length > 0 ? group.oms.join(", ") : <span className="td-muted">-</span>}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="empty-state" colSpan={6}>
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

              <PeopleCard note="열람 기록 남음" title="연락처">
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
