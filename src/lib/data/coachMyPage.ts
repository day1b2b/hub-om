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

export interface MyConfirmedCourseCoach {
  coachId: string;
  coachName: string;
  engagementId: string;
  rating: number | null;
  feedback: string | null;
}

export interface MyConfirmedCourse {
  courseName: string;
  startDate: string;
  endDate: string;
  coaches: MyConfirmedCourseCoach[];
}

// 본인이 예약했던 코치·날짜가 실제 투입으로 확정되면서 자동 취소된 건들을,
// 과정(과정명+기간) 단위로 묶어 마이페이지에 보여준다.
export async function listMyConfirmedCourses(email: string): Promise<MyConfirmedCourse[]> {
  if (!email) return [];

  const prisma = getPrismaClient();
  const rows = await prisma.coachDayReservation.findMany({
    where: { reservedByEmail: email, confirmedEngagementId: { not: null } },
    select: {
      coach: { select: { id: true, name: true } },
      confirmedEngagement: {
        select: { id: true, courseName: true, startDate: true, endDate: true, rating: true, feedback: true }
      }
    }
  });

  const groups = new Map<string, MyConfirmedCourse>();
  for (const row of rows) {
    const engagement = row.confirmedEngagement;
    if (!engagement) continue;

    const key = `${engagement.courseName}|${toDateKey(engagement.startDate)}|${toDateKey(engagement.endDate)}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        courseName: engagement.courseName,
        startDate: toDateKey(engagement.startDate),
        endDate: toDateKey(engagement.endDate),
        coaches: []
      };
      groups.set(key, group);
    }

    if (!group.coaches.some((c) => c.engagementId === engagement.id)) {
      group.coaches.push({
        coachId: row.coach.id,
        coachName: row.coach.name,
        engagementId: engagement.id,
        rating: engagement.rating,
        feedback: engagement.feedback
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.endDate.localeCompare(a.endDate));
}
