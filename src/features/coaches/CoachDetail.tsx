import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { PeopleFlagPill } from "@/features/people/PeopleDirectory";
import {
  PeopleCard,
  PeopleCollapsible,
  PeopleDetailBody,
  PeopleDetailHeader,
  PeopleFacts,
  PeopleStatusPill
} from "@/features/people/PeopleProfile";
import type { CoachActivity } from "@/lib/coaches/coachActivity";
import type {
  CoachDetail,
  CoachEngagementScheduleView,
  CoachEngagementStatusValue,
  CoachEngagementView,
  CoachScheduleView,
  CoachStatusValue
} from "@/lib/data/coachTypes";
import { formatPeopleDate, type PeopleStatus } from "@/lib/people/peopleStatus";
import { CoachInputLinkActions } from "./CoachInputLinkActions";
import { CoachNotesPanel, CoachPinnedNotes } from "./CoachNotesPanel";
import { CoachEvaluationProvider, EngagementEvaluationButton, EngagementEvaluationPanel } from "./CoachEngagementEvaluation";
import { MaskedField } from "./MaskedField";

// 코치 위키 상세. 강사 위키와 같은 틀(헤더 → 고정 알림 → 본문 2단)을 쓴다.
// 기본 화면은 한 페이지(소개·투입 이력·운영 메모 + 가용성·조건·연락처·관리). 월 달력만 ?tab=schedule로 따로 연다.
export type CoachDetailTab = "profile" | "schedule";

const COACH_DB_STATUS_LABEL: Record<CoachStatusValue, string> = {
  active: "활동중",
  pending: "대기",
  inactive: "비활동"
};

// 코치 DB(노션) 상태. 활동중이 아니면 섭외 전에 확인할 주의로 보여 준다.
const COACH_DB_FLAG: Partial<Record<CoachStatusValue, string>> = {
  pending: "코치 DB 대기",
  inactive: "코치 DB 비활동"
};

const ENGAGEMENT_STATUS_LABEL: Record<CoachEngagementStatusValue, string> = {
  scheduled: "예정",
  in_progress: "진행",
  completed: "완료",
  cancelled: "취소"
};

const ENGAGEMENT_STATUS_CLASS: Record<CoachEngagementStatusValue, string> = {
  scheduled: "planned-assignment",
  in_progress: "active",
  completed: "done",
  cancelled: "needs-assignment"
};

interface CoachDetailViewProps {
  coach: CoachDetail;
  activity: CoachActivity;
  peopleStatus: PeopleStatus;
  /** 한국 기준 오늘(YYYY-MM-DD). */
  today: string;
  engagementSchedules: CoachEngagementScheduleView[];
  engagements: CoachEngagementView[];
  schedules: CoachScheduleView[];
  selectedMonth: string;
  selectedTab: CoachDetailTab;
}

export function CoachDetailView({
  coach,
  activity,
  peopleStatus,
  today,
  engagementSchedules,
  engagements,
  schedules,
  selectedMonth,
  selectedTab
}: CoachDetailViewProps) {
  const poolFlag = COACH_DB_FLAG[coach.status];
  const nextEngagement = engagements
    .filter((engagement) => engagement.status === "scheduled")
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const notionUrl = coach.notionPageId ? `https://www.notion.so/${coach.notionPageId.replaceAll("-", "")}` : null;

  const pinned = [
    ...(poolFlag ? [{ key: "pool", text: `${poolFlag} 상태예요. 섭외 전에 코치 DB 상태를 확인해 주세요.`, tone: "warn" as const }] : []),
    ...(coach.statusNote ? [{ key: "note", text: coach.statusNote, tone: "warn" as const }] : []),
    ...(coach.returnDate ? [{ key: "return", text: `복귀 예정 ${formatDateLabel(coach.returnDate)}`, tone: "warn" as const }] : [])
  ];

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Coach detail" teamScope="both" />

      <section className="content people-detail">
        <PeopleDetailHeader
          actions={
            notionUrl ? (
              <a className="notion-chip" href={notionUrl} rel="noreferrer" target="_blank">🔗 노션 원본 ↗</a>
            ) : (
              <span className="notion-chip is-off">노션 미연결</span>
            )
          }
          avatarName={coach.name}
          backHref="/coaches"
          backLabel="코치 위키"
          badges={
            <>
              <PeopleStatusPill status={peopleStatus} />
              {poolFlag ? <PeopleFlagPill flag={{ label: poolFlag, tone: "warn" }} /> : null}
              {!coach.isActive ? <span className="coach-origin-muted-pill">비노출</span> : null}
              {coach.deletedAt ? <span className="coach-origin-muted-pill deleted">삭제됨</span> : null}
            </>
          }
          fields={coach.fields}
          kpis={[
            { label: "투입", value: `${activity.deployCount}회` },
            { label: "최근 투입", value: activity.lastDeployDate ? formatPeopleDate(activity.lastDeployDate, today) : "-" },
            {
              label: "OM 평가 (최근)",
              value:
                coach.recentAvgRating !== null ? (
                  <>{coach.recentAvgRating.toFixed(1)} <small>{coach.recentRatingCount}건</small></>
                ) : coach.recentRatingCount > 0 ? (
                  <small>평가 {coach.recentRatingCount}건</small>
                ) : (
                  "-"
                )
            },
            { label: "다음 예정", value: nextEngagement ? formatPeopleDate(nextEngagement.startDate, today) : "-" }
          ]}
          title={<h1>{coach.name}</h1>}
        />

        {/* 고정 메모는 메모·리뷰 관리에서 고정한 코치 메모(flagged_at). 브라우저에서 메모 API로 읽는다. */}
        <CoachPinnedNotes coachId={coach.id} items={pinned} />

        {selectedTab === "schedule" ? (
          <>
            <nav className="people-subnav" aria-label="코치 상세">
              <Link href={`/coaches/${coach.id}`}>← 프로필로 돌아가기</Link>
              <strong>월 달력</strong>
            </nav>
            <SchedulePane
              coach={coach}
              engagementSchedules={engagementSchedules}
              engagements={engagements}
              schedules={schedules}
              selectedMonth={selectedMonth}
            />
          </>
        ) : (
          <PeopleDetailBody
            main={
              <>
                <PeopleCard note="코치 DB" title="소개 · 전문분야">
                  <PeopleFacts
                    items={[
                      { label: "전문분야", value: coach.fields.length > 0 ? <ChipList items={coach.fields} tone="green" /> : "" },
                      { label: "가능 커리큘럼", value: coach.curriculums.length > 0 ? <ChipList items={coach.curriculums} tone="mixed" /> : "" },
                      { label: "DX 태그", value: coach.dxTag ?? "" }
                    ]}
                  />
                </PeopleCard>

                <PeopleCard
                  note={<>OM 전용 · 고정은 <Link href="/changes#content">전체 변경 이력 › 메모·리뷰 관리</Link>에서</>}
                  title="운영 메모"
                >
                  <CoachNotesPanel coachId={coach.id} />
                </PeopleCard>

                {/* 강사 위키와 같이 투입 이력은 맨 아래에 접어 둔다. */}
                <PeopleCollapsible id="engagements" note={`${engagements.length}건 · 건마다 OM 평가`} title="투입 이력">
                  <Link className="people-card-link" href={`/coaches/${coach.id}/engagements`}>표로 보기 →</Link>
                  <EngagementPane coachId={coach.id} engagements={engagements} />
                </PeopleCollapsible>
              </>
            }
            side={
              <>
                <PeopleCard note={`${selectedMonth} 기준`} title="가용성">
                  <MonthAvailability engagementSchedules={engagementSchedules} schedules={schedules} />
                  <p className="coach-origin-preline">{coach.availabilityDetail || "등록된 근무 가능 세부 내용이 없습니다."}</p>
                  <Link className="people-card-link" href={`/coaches/${coach.id}?tab=schedule&month=${selectedMonth}`}>월 달력 보기 →</Link>
                </PeopleCard>

                <PeopleCard title="조건">
                  <PeopleFacts items={[{ label: "근무유형", value: splitWorkTypes(coach.workType).join(" · ") }]} />
                </PeopleCard>

                <PeopleCard note="열람 기록 남음" title="연락처">
                  <div className="people-contact">
                    <MaskedField entity="coach" field="phone" id={coach.id} label="전화번호" />
                    <MaskedField entity="coach" field="email" id={coach.id} label="이메일" />
                    <MaskedField entity="coach" field="affiliation" id={coach.id} label="소속" />
                  </div>
                </PeopleCard>

                <PeopleCard title="관리">
                  <PeopleFacts
                    items={[
                      { label: "코치 DB 상태", value: COACH_DB_STATUS_LABEL[coach.status] },
                      { label: "노출", value: coach.isActive ? "노출" : "비노출" },
                      { label: "삭제", value: coach.deletedAt ? "삭제됨" : "정상" }
                    ]}
                  />
                  <div className="people-card-sub">
                    <span>코치 입력 링크</span>
                    <CoachInputLinkActions url={coach.coachInputUrl} />
                  </div>
                </PeopleCard>
              </>
            }
          />
        )}
      </section>
    </main>
  );
}

function MonthAvailability({
  engagementSchedules,
  schedules
}: {
  engagementSchedules: CoachEngagementScheduleView[];
  schedules: CoachScheduleView[];
}) {
  const availableDays = new Set(schedules.map((schedule) => schedule.date)).size;
  const confirmedDays = new Set(engagementSchedules.map((schedule) => schedule.date)).size;
  return (
    <PeopleFacts
      items={[
        { label: "가능일", value: `${availableDays}일` },
        { label: "확정일", value: `${confirmedDays}일` },
        { label: "가능 시간", value: formatDistinctTimes(schedules) }
      ]}
    />
  );
}

function SchedulePane({
  coach,
  engagementSchedules,
  engagements,
  schedules,
  selectedMonth
}: {
  coach: CoachDetail;
  engagementSchedules: CoachEngagementScheduleView[];
  engagements: CoachEngagementView[];
  schedules: CoachScheduleView[];
  selectedMonth: string;
}) {
  const { year, monthIndex } = parseYearMonth(selectedMonth);
  const availableDates = new Set(schedules.map((schedule) => schedule.date));
  const confirmedDates = new Set(engagementSchedules.map((schedule) => schedule.date));
  const schedulesByDate = groupByDate(schedules);
  const engagementSchedulesByDate = groupByDate(engagementSchedules);
  const sixMonthSummary = buildSixMonthSummary(engagements, selectedMonth);
  const prevMonth = shiftMonth(selectedMonth, -1);
  const nextMonth = shiftMonth(selectedMonth, 1);

  return (
    <section className="coach-origin-schedule-layout">
      <section className="coach-origin-calendar-card">
        <div className="coach-origin-calendar-header">
          <span className="coach-origin-access-chip">입력완료</span>
          <Link aria-label="이전 달" href={`?tab=schedule&month=${prevMonth}`}>‹</Link>
          <strong>{year}년 {monthIndex + 1}월</strong>
          <Link aria-label="다음 달" href={`?tab=schedule&month=${nextMonth}`}>›</Link>
        </div>

        <div className="coach-origin-weekdays" aria-hidden="true">
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}
        </div>

        <div className="coach-origin-calendar-grid">
          {buildCalendarCells(year, monthIndex).map((date, index) => {
            if (!date) return <span aria-hidden="true" className="coach-origin-calendar-empty" key={`empty-${index}`} />;

            const day = Number(date.slice(-2));
            const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
            const isAvailable = availableDates.has(date);
            const isConfirmed = confirmedDates.has(date);
            const className = [
              "coach-origin-calendar-day",
              isConfirmed ? "confirmed" : "",
              !isConfirmed && isAvailable ? "available" : "",
              dayOfWeek === 0 ? "sunday" : "",
              dayOfWeek === 6 ? "saturday" : ""
            ].filter(Boolean).join(" ");

            return (
              <div className={className} key={date}>
                <span>{day}</span>
              </div>
            );
          })}
        </div>

        <div className="coach-origin-legend">
          <span><i className="available" />가능</span>
          <span><i className="confirmed" />확정</span>
          <span><i />선택 중</span>
        </div>

        <div className="coach-origin-work-summary">
          <div>
            <span>최근 6개월 누적 근무일 수</span>
            <strong>{sixMonthSummary.total}일</strong>
          </div>
          <div className="coach-origin-mini-bars">
            {sixMonthSummary.months.map((month) => (
              <span key={month.label}>
                <i style={{ height: `${Math.max(6, month.count * 3)}px` }} />
                <small>{month.label}</small>
                <b>{month.count}</b>
              </span>
            ))}
          </div>
        </div>
      </section>

      <aside className="coach-origin-schedule-side">
        <section className="coach-origin-card">
          <div className="coach-origin-section-title">
            <span>근무 가능 세부 내용</span>
          </div>
          <p className="coach-origin-preline">{coach.availabilityDetail || "등록된 근무 가능 세부 내용이 없습니다."}</p>
        </section>

        <section className="coach-origin-card">
          <div className="coach-origin-section-title">
            <span>{selectedMonth} 월간 요약</span>
          </div>
          <div className="coach-origin-info-list">
            <InfoItem label="가능일" value={`${availableDates.size}일`} />
            <InfoItem label="확정일" value={`${confirmedDates.size}일`} />
            <InfoItem label="가능 시간" value={formatDistinctTimes(schedules)} />
          </div>
        </section>

        <section className="coach-origin-card">
          <div className="coach-origin-section-title">
            <span>월간 일정</span>
          </div>
          <div className="coach-origin-day-list">
            {mergeMonthlyScheduleRows(schedulesByDate, engagementSchedulesByDate).length > 0 ? (
              mergeMonthlyScheduleRows(schedulesByDate, engagementSchedulesByDate).map((row) => (
                <div key={`${row.date}-${row.kind}-${row.label}`}>
                  <strong>{formatDateLabel(row.date)}</strong>
                  <span className={row.kind}>{row.kind === "confirmed" ? "확정" : "가능"}</span>
                  <small>{row.label}</small>
                </div>
              ))
            ) : (
              <p className="coach-origin-empty-text">이 달에 등록된 일정이 없습니다.</p>
            )}
          </div>
        </section>
      </aside>
    </section>
  );
}

function EngagementPane({ coachId, engagements }: { coachId: string; engagements: CoachEngagementView[] }) {
  return (
    <section className="coach-origin-engagement-list">
      {engagements.length > 0 ? (
        <CoachEvaluationProvider coachId={coachId}>
          {engagements.map((engagement) => (
            <div className="coach-origin-engagement-item" key={engagement.id}>
              <article className="coach-origin-engagement-row">
                <span className={`status ${ENGAGEMENT_STATUS_CLASS[engagement.status]}`}>
                  {ENGAGEMENT_STATUS_LABEL[engagement.status]}
                </span>
                <time>
                  {formatDateLabel(engagement.startDate)}
                  {engagement.endDate ? `~${formatDateLabel(engagement.endDate)}` : ""}
                </time>
                <span className="coach-origin-engagement-course">
                  <strong>{cleanCourseName(engagement.courseName)}</strong>
                  {engagement.feedback ? <small className="coach-origin-engagement-summary">{engagement.feedback}</small> : null}
                </span>
                {engagement.rating ? (
                  <small className="coach-origin-engagement-rating">평점 {engagement.rating}</small>
                ) : <span />}
                <EngagementEvaluationButton engagement={evaluableEngagement(engagement)} />
              </article>
              <EngagementEvaluationPanel engagement={evaluableEngagement(engagement)} />
            </div>
          ))}
        </CoachEvaluationProvider>
      ) : (
        <div className="coach-origin-empty-panel">등록된 근무 이력이 없습니다.</div>
      )}
    </section>
  );
}

function evaluableEngagement(engagement: CoachEngagementView) {
  return { id: engagement.id, startDate: engagement.startDate, endDate: engagement.endDate, cancelled: engagement.status === "cancelled" };
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="coach-origin-info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChipList({ items, tone }: { items: string[]; tone: "green" | "mixed" }) {
  if (items.length === 0) return <p className="coach-origin-empty-text">등록된 항목이 없습니다.</p>;

  return (
    <div className="coach-origin-chip-list">
      {items.map((item) => (
        <span className={`coach-origin-chip ${tone === "mixed" ? curriculumTone(item) : tone}`} key={item}>{item}</span>
      ))}
    </div>
  );
}

function splitWorkTypes(value: string | null): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parseYearMonth(yearMonth: string): { year: number; monthIndex: number } {
  const [year, month] = yearMonth.split("-").map(Number);
  return { year, monthIndex: month - 1 };
}

function shiftMonth(yearMonth: string, offset: number): string {
  const { year, monthIndex } = parseYearMonth(yearMonth);
  const date = new Date(year, monthIndex + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildCalendarCells(year: number, monthIndex: number): Array<string | null> {
  const firstDayOfWeek = new Date(year, monthIndex, 1).getDay();
  const lastDate = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<string | null> = [];

  for (let index = 0; index < firstDayOfWeek; index += 1) cells.push(null);
  for (let day = 1; day <= lastDate; day += 1) {
    cells.push(`${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length < 42) cells.push(null);
  return cells;
}

function groupByDate<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const list = grouped.get(item.date) ?? [];
    list.push(item);
    grouped.set(item.date, list);
  }
  return grouped;
}

function mergeMonthlyScheduleRows(
  available: Map<string, CoachScheduleView[]>,
  confirmed: Map<string, CoachEngagementScheduleView[]>
): Array<{ date: string; kind: "available" | "confirmed"; label: string }> {
  const rows: Array<{ date: string; kind: "available" | "confirmed"; label: string }> = [];

  for (const [date, items] of confirmed) {
    rows.push({
      date,
      kind: "confirmed",
      label: items.map((item) => `${item.startTime}~${item.endTime} ${cleanCourseName(item.courseName)}`).join(", ")
    });
  }

  for (const [date, items] of available) {
    rows.push({
      date,
      kind: "available",
      label: formatDistinctTimes(items)
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "confirmed" ? -1 : 1));
}

function buildSixMonthSummary(engagements: CoachEngagementView[], selectedMonth: string) {
  const { year, monthIndex } = parseYearMonth(selectedMonth);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(year, monthIndex - 5 + index, 1);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const count = countEngagementDaysInMonth(engagements, yearMonth);
    return { label: `${date.getMonth() + 1}월`, count };
  });

  return {
    months,
    total: months.reduce((sum, item) => sum + item.count, 0)
  };
}

function countEngagementDaysInMonth(engagements: CoachEngagementView[], yearMonth: string): number {
  const { year, monthIndex } = parseYearMonth(yearMonth);
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const dates = new Set<string>();

  for (const engagement of engagements) {
    const engagementStart = new Date(`${engagement.startDate}T00:00:00`);
    const engagementEnd = new Date(`${engagement.endDate}T00:00:00`);
    const from = engagementStart > start ? engagementStart : start;
    const to = engagementEnd < end ? engagementEnd : end;
    if (from > to) continue;

    for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
      dates.add(formatDate(cursor));
    }
  }

  return dates.size;
}

function formatDistinctTimes(items: Array<{ startTime: string; endTime: string }>): string {
  const labels = Array.from(new Set(items.map((item) => formatTimeLabel(item.startTime, item.endTime))));
  return labels.length > 0 ? labels.join(", ") : "-";
}

function formatTimeLabel(startTime: string, endTime: string): string {
  const startHour = Number(startTime.slice(0, 2));
  const endHour = Number(endTime.slice(0, 2));
  const parts: string[] = [];
  if (startHour < 13 && endHour > 8) parts.push("오전");
  if (startHour < 18 && endHour > 13) parts.push("오후");
  if (endHour > 18 || startHour >= 18) parts.push("저녁");
  if (parts.length >= 3) return "전일";
  return parts.length > 0 ? parts.join("·") : `${startTime}~${endTime}`;
}

function cleanCourseName(value: string): string {
  return value
    .replace(/\[부가세\s*별도\]\s*/g, "")
    .replace(/\(B2B\)\s*/g, "")
    .replace(/_/g, " ")
    .trim() || value;
}

function curriculumTone(name: string): string {
  if (/Python|Java|HTML|CSS|JavaScript|React|Vue|Next|Node|Spring|Django|Flask/.test(name)) return "blue";
  if (/데이터|SQL|AI|인공지능|머신러닝|딥러닝|ChatGPT|생성형/.test(name)) return "purple";
  if (/AWS|Azure|GCP|Docker|Kubernetes|클라우드|DevOps/.test(name)) return "orange";
  if (/OA|PPT|Excel|자동화|업무/.test(name)) return "green";
  return "gray";
}

function formatDateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[1]}.${Number(match[2])}.${Number(match[3])}`;
}

function formatDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
