import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import type {
  CoachDetail,
  CoachEngagementScheduleView,
  CoachEngagementStatusValue,
  CoachEngagementView,
  CoachScheduleView,
  CoachStatusValue
} from "@/lib/data/coachTypes";
import { CoachDeleteButton } from "./CoachDeleteButton";
import { CoachInputLinkActions } from "./CoachInputLinkActions";
import { CoachNotesPanel } from "./CoachNotesPanel";
import { CoachProfileEditForm } from "./CoachProfileEditForm";
import { CoachStatusToggle } from "./CoachStatusToggle";

export type CoachDetailTab = "profile" | "schedule" | "engagements";

const STATUS_LABEL: Record<CoachStatusValue, string> = {
  active: "활동중",
  pending: "대기",
  inactive: "비활동"
};

const STATUS_CLASS: Record<CoachStatusValue, string> = {
  active: "active",
  pending: "planned-assignment",
  inactive: "needs-assignment"
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
  engagementSchedules: CoachEngagementScheduleView[];
  engagements: CoachEngagementView[];
  schedules: CoachScheduleView[];
  selectedMonth: string;
  selectedTab: CoachDetailTab;
}

export function CoachDetailView({
  coach,
  engagementSchedules,
  engagements,
  schedules,
  selectedMonth,
  selectedTab
}: CoachDetailViewProps) {
  return (
    <main className="dashboard-shell">
      <AppSidebar label="Coach detail" teamScope="both" />

      <section className="content coach-origin-detail-content">
        <header className="coach-origin-detail-header">
          <div className="coach-origin-title-row">
            <Link aria-label="코치 목록으로 이동" className="coach-origin-back-link" href="/coaches">←</Link>
            <h1>{coach.name}</h1>
            <span className={`status ${STATUS_CLASS[coach.status]}`}>{STATUS_LABEL[coach.status]}</span>
            {!coach.isActive ? <span className="coach-origin-muted-pill">비노출</span> : null}
            {coach.deletedAt ? <span className="coach-origin-muted-pill deleted">삭제됨</span> : null}
            {coach.statusNote ? <span className="coach-origin-note">+ {coach.statusNote}</span> : null}
            {!coach.deletedAt ? <CoachStatusToggle coachId={coach.id} status={coach.status} /> : null}
            {!coach.deletedAt ? <CoachDeleteButton coachId={coach.id} coachName={coach.name} /> : null}
          </div>
          <div className="coach-origin-tags">
            {splitWorkTypes(coach.workType).map((workType) => (
              <span className="coach-origin-worktype" key={workType}>{workType}</span>
            ))}
            {coach.dxTag ? <span className="coach-origin-worktype amber">{coach.dxTag}</span> : null}
            {coach.returnDate ? <span className="coach-origin-note">복귀 예정 {formatDateLabel(coach.returnDate)}</span> : null}
          </div>
        </header>

        <nav className="coach-detail-tabs coach-origin-tabs" aria-label="코치 상세 탭">
          <DetailTab coachId={coach.id} label="프로필" selected={selectedTab === "profile"} tab="profile" />
          <DetailTab coachId={coach.id} label="스케줄" selected={selectedTab === "schedule"} tab="schedule" />
          <DetailTab coachId={coach.id} label="근무 이력" selected={selectedTab === "engagements"} tab="engagements" />
        </nav>

        {selectedTab === "profile" ? <ProfilePane coach={coach} /> : null}
        {selectedTab === "schedule" ? (
          <SchedulePane
            coach={coach}
            engagementSchedules={engagementSchedules}
            engagements={engagements}
            schedules={schedules}
            selectedMonth={selectedMonth}
          />
        ) : null}
        {selectedTab === "engagements" ? <EngagementPane engagements={engagements} /> : null}
      </section>
    </main>
  );
}

function DetailTab({
  coachId,
  label,
  selected,
  tab
}: {
  coachId: string;
  label: string;
  selected: boolean;
  tab: CoachDetailTab;
}) {
  const href = tab === "profile" ? `/coaches/${coachId}` : `/coaches/${coachId}?tab=${tab}`;
  return <Link className={selected ? "selected" : ""} href={href}>{label}</Link>;
}

function ProfilePane({ coach }: { coach: CoachDetail }) {
  return (
    <section className="coach-origin-profile-grid">
      <section className="coach-origin-card">
        <div className="coach-origin-section-title">
          <span>공개 프로필</span>
        </div>
        <div className="coach-origin-info-list">
          <InfoItem label="이름" value={coach.name} />
          <InfoItem label="상태" value={STATUS_LABEL[coach.status]} />
          <InfoItem label="근무유형" value={coach.workType || "-"} />
          <InfoItem label="노출 상태" value={coach.isActive ? "노출" : "비노출"} />
          <InfoItem label="삭제 상태" value={coach.deletedAt ? "삭제됨" : "정상"} />
        </div>
        {!coach.deletedAt ? <CoachProfileEditForm coach={coach} /> : null}
      </section>

      <section className="coach-origin-card">
        <div className="coach-origin-section-title">
          <span>코치 입력 링크</span>
        </div>
        <CoachInputLinkActions url={coach.coachInputUrl} />
      </section>

      <section className="coach-origin-card coach-origin-wide-card">
        <div className="coach-origin-section-title">
          <span>가능 분야</span>
        </div>
        <ChipList items={coach.fields} tone="green" />
      </section>

      <section className="coach-origin-card coach-origin-wide-card">
        <div className="coach-origin-section-title">
          <span>가능 커리큘럼</span>
        </div>
        <ChipList items={coach.curriculums} tone="mixed" />
      </section>

      <section className="coach-origin-card coach-origin-wide-card">
        <div className="coach-origin-section-title">
          <span>메모</span>
        </div>
        <CoachNotesPanel coachId={coach.id} />
      </section>
    </section>
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

function EngagementPane({ engagements }: { engagements: CoachEngagementView[] }) {
  return (
    <section className="coach-origin-engagement-list">
      {engagements.length > 0 ? (
        engagements.map((engagement) => (
          <article className="coach-origin-engagement-row" key={engagement.id}>
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
            ) : null}
          </article>
        ))
      ) : (
        <div className="coach-origin-empty-panel">등록된 근무 이력이 없습니다.</div>
      )}
    </section>
  );
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
