import type { CoachEngagementStatus } from "@prisma/client";
import { toDateKey } from "@/lib/coaches/dateParse";
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

// 본인이 예약했던 코치·날짜가 실제 투입으로 확정되면서 자동 취소된 건들을,
// 과정명 단위로 묶어 마이페이지에 보여준다. 같은 과정이라도 코치별로
// 투입 기간이 다를 수 있어 카드 안에서는 코치별 기간을 따로 보여주고,
// 카드 헤더의 기간은 그 코치들 기간을 모두 합친 범위로 표시한다.
export async function listMyConfirmedCourses(email: string): Promise<MyConfirmedCourse[]> {
  if (!email) return [];

  const prisma = getPrismaClient();
  const rows = await prisma.coachDayReservation.findMany({
    where: { reservedByEmail: email, confirmedEngagementId: { not: null } },
    select: {
      coach: { select: { id: true, name: true } },
      confirmedEngagement: {
        select: { id: true, courseName: true, startDate: true, endDate: true, status: true, rating: true, feedback: true, rehire: true }
      }
    }
  });

  const engagementIds = [...new Set(rows.map((row) => row.confirmedEngagement?.id).filter((id): id is string => !!id))];
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
  for (const row of rows) {
    const engagement = row.confirmedEngagement;
    if (!engagement) continue;

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
        coachId: row.coach.id,
        coachName: row.coach.name,
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
