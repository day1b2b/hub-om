import { normalizePersonName, resolveOmNameByEmail } from "./myOperations";
import { splitPersonNames } from "./personNames";
import { getPrismaClient } from "./prisma";
import type { CoachManagerMyPageRepository, MyActiveReservation, MyConfirmedCourse } from "./coachManagerMyPageRepository";
import { groupConfirmedCourses, toMyActiveReservations, type EngagementWithCoach } from "./coachMyPagePresentation";

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

/** Default PostgreSQL adapter: preserve legacy queries and team-user name resolution. */
export class PrismaCoachManagerMyPageRepository implements CoachManagerMyPageRepository {
  async listMyActiveReservations(email: string): Promise<MyActiveReservation[]> {
    if (!email) return [];

    const prisma = getPrismaClient();
    const rows = await prisma.coachDayReservation.findMany({
      where: { reservedByEmail: email, cancelledAt: null },
      select: { date: true, coach: { select: { id: true, name: true } } },
      orderBy: [{ date: "asc" }]
    });

    return toMyActiveReservations(rows);
  }

  async listMyConfirmedCourses(email: string): Promise<MyConfirmedCourse[]> {
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
    return groupConfirmedCourses(byEngagementId.values(), scheduleRows);
  }
}
