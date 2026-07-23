import type { CoachEngagementStatus } from "@prisma/client";
import { toDateKey } from "@/lib/coaches/dateParse";
import { normalizePersonName, resolveOmNameByEmail } from "./myOperations";
import { splitPersonNames } from "./personNames";
import { getPrismaClient } from "./prisma";

export interface MyActiveReservation {
  coachId: string;
  coachName: string;
  date: string;
}

// 로그인한 매니저 본인이 현재 잡고 있는(취소되지 않은) 예약 목록.
export async function listMyActiveReservations(email: string): Promise<MyActiveReservation[]> {
  if (!email) return [];

  const prisma = getPrismaClient();
  const rows = await prisma.coachDayReservation.findMany({
    where: { reservedByEmail: email, cancelledAt: null },
    select: { date: true, coach: { select: { id: true, name: true } } },
    orderBy: [{ date: "asc" }]
  });

  return rows.map((row) => ({
    coachId: row.coach.id,
    coachName: row.coach.name,
    date: toDateKey(row.date)
  }));
}

const STATUS_LABEL: Record<CoachEngagementStatus, string> = {
  SCHEDULED: "예정",
  IN_PROGRESS: "진행",
  COMPLETED: "완료",
  CANCELLED: "취소"
};

export interface MyConfirmedCourseRound {
  date: string;
  startTime: string;
  endTime: string;
}

export interface MyConfirmedCourseCoach {
  coachId: string;
  coachName: string;
  engagementId: string;
  startDate: string;
  endDate: string;
  statusLabel: string;
  rating: number | null;
  feedback: string | null;
  rehire: boolean | null;
  rounds: MyConfirmedCourseRound[];
}

export interface MyConfirmedCourse {
  courseName: string;
  startDate: string;
  endDate: string;
  coaches: MyConfirmedCourseCoach[];
}

const ENGAGEMENT_SELECT = {
  id: true,
  courseName: true,
  startDate: true,
  endDate: true,
  status: true,
  rating: true,
  feedback: true,
  rehire: true
} as const;

interface EngagementWithCoach {
  coach: { id: string; name: string };
  engagement: {
    id: string;
    courseName: string;
    startDate: Date;
    endDate: Date;
    status: CoachEngagementStatus;
    rating: number | null;
    feedback: string | null;
    rehire: boolean | null;
  };
}

// 본인이 예약했던 코치·날짜가 실제 투입으로 확정되면서 자동 취소된 건들과,
// 계약 시트의 "담당자"(hiredByText)가 본인 이름과 일치하는 건(예약 없이
// 바로 확정된 건 포함)을 모아, 과정명 단위로 묶어 마이페이지에 보여준다.
// 같은 과정이라도 코치별로 투입 기간이 다를 수 있어 카드 안에서는 코치별
// 기간을 따로 보여주고, 카드 헤더의 기간은 그 코치들 기간을 모두 합친
// 범위로 표시한다.
export async function listMyConfirmedCourses(email: string): Promise<MyConfirmedCourse[]> {
  if (!email) return [];

  const prisma = getPrismaClient();

  const reservationRows = await prisma.coachDayReservation.findMany({
    where: { reservedByEmail: email, confirmedEngagementId: { not: null } },
    select: {
      coach: { select: { id: true, name: true } },
      confirmedEngagement: { select: ENGAGEMENT_SELECT }
    }
  });

  const byEngagementId = new Map<string, EngagementWithCoach>();
  for (const row of reservationRows) {
    if (!row.confirmedEngagement) continue;
    byEngagementId.set(row.confirmedEngagement.id, { coach: row.coach, engagement: row.confirmedEngagement });
  }

  // 계약 시트 동기화로 예약 단계 없이 바로 들어온 확정 건도, 담당자 이름이
  // 나와 일치하면 함께 보여준다. hiredByText는 자유 텍스트라 정확한 이름
  // 매칭이 안 될 수 있음(오타·별명 등) — 그런 경우 이 화면엔 안 뜬다.
  const myOmName = await resolveOmNameByEmail(email);
  if (myOmName) {
    const target = normalizePersonName(myOmName);
    const candidates = await prisma.coachEngagement.findMany({
      where: { hiredByText: { contains: myOmName } },
      select: { ...ENGAGEMENT_SELECT, hiredByText: true, coach: { select: { id: true, name: true } } }
    });
    for (const candidate of candidates) {
      if (byEngagementId.has(candidate.id)) continue;
      const matches = splitPersonNames(candidate.hiredByText).some((name) => normalizePersonName(name) === target);
      if (!matches) continue;
      byEngagementId.set(candidate.id, { coach: candidate.coach, engagement: candidate });
    }
  }

  const engagementIds = [...byEngagementId.keys()];
  const scheduleRows = engagementIds.length
    ? await prisma.coachEngagementSchedule.findMany({
        where: { engagementId: { in: engagementIds }, cancelledAt: null },
        select: { engagementId: true, date: true, startTime: true, endTime: true },
        orderBy: [{ date: "asc" }]
      })
    : [];
  const roundsByEngagement = new Map<string, MyConfirmedCourseRound[]>();
  for (const schedule of scheduleRows) {
    const list = roundsByEngagement.get(schedule.engagementId) ?? [];
    list.push({ date: toDateKey(schedule.date), startTime: schedule.startTime, endTime: schedule.endTime });
    roundsByEngagement.set(schedule.engagementId, list);
  }

  const groups = new Map<string, MyConfirmedCourse>();
  for (const { coach, engagement } of byEngagementId.values()) {
    const engagementStartDate = toDateKey(engagement.startDate);
    const engagementEndDate = toDateKey(engagement.endDate);

    let group = groups.get(engagement.courseName);
    if (!group) {
      group = { courseName: engagement.courseName, startDate: engagementStartDate, endDate: engagementEndDate, coaches: [] };
      groups.set(engagement.courseName, group);
    } else {
      if (engagementStartDate < group.startDate) group.startDate = engagementStartDate;
      if (engagementEndDate > group.endDate) group.endDate = engagementEndDate;
    }

    if (!group.coaches.some((c) => c.engagementId === engagement.id)) {
      group.coaches.push({
        coachId: coach.id,
        coachName: coach.name,
        engagementId: engagement.id,
        startDate: engagementStartDate,
        endDate: engagementEndDate,
        statusLabel: STATUS_LABEL[engagement.status],
        rating: engagement.rating,
        feedback: engagement.feedback,
        rehire: engagement.rehire,
        rounds: roundsByEngagement.get(engagement.id) ?? []
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.endDate.localeCompare(a.endDate));
}

export interface PartitionedConfirmedCourses {
  inProgress: MyConfirmedCourse[];
  past: MyConfirmedCourse[];
}

// 과정 전체 기간(코치들 중 가장 늦은 종료일)이 오늘보다 이전이면 지난 과정으로,
// 그 외(오늘 포함 진행 중이거나 아직 시작 전)에는 진행중 과정으로 분류한다.
export function partitionConfirmedCourses(courses: MyConfirmedCourse[], todayIso: string): PartitionedConfirmedCourses {
  const inProgress: MyConfirmedCourse[] = [];
  const past: MyConfirmedCourse[] = [];

  for (const course of courses) {
    if (course.endDate < todayIso) past.push(course);
    else inProgress.push(course);
  }

  return {
    inProgress: inProgress.sort((a, b) => a.startDate.localeCompare(b.startDate)),
    past
  };
}
