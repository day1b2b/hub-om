import type { Prisma } from "@prisma/client";
import type { CoachOperationMatchRepository, CoachOperationMatchSnapshot } from "./coachOperationMatchRepository";
import { lockPrismaCoachCatalog } from "./prismaCoachLock";
import { getPrismaClient } from "./prisma";

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

export class PrismaCoachOperationMatchRepository implements CoachOperationMatchRepository {
  async readSnapshot(): Promise<CoachOperationMatchSnapshot> {
    const prisma = getPrismaClient();
    const [total, matched, candidates, engagements] = await Promise.all([
      prisma.coachEngagement.count(),
      prisma.coachEngagement.count({ where: { operationSessionId: { not: null } } }),
      prisma.operationSession.findMany({
        where: { deletedAt: null },
        select: { id: true, operationId: true, startDate: true, endDate: true, timeText: true, coachText: true,
          instructorsText: true, course: { select: { name: true, company: { select: { name: true } } } } }
      }),
      prisma.coachEngagement.findMany({
        where: { operationSessionId: null }, orderBy: [{ startDate: "desc" }, { courseName: "asc" }],
        select: { id: true, courseName: true, startDate: true, endDate: true, startTime: true, endTime: true,
          coach: { select: { name: true } }, schedules: { where: { cancelledAt: null }, select: { date: true, startTime: true, endTime: true } } }
      })
    ]);
    return {
      counts: { total, matched, unmatched: total - matched },
      candidates: candidates.map(row => ({ id: row.id, operationId: row.operationId, companyName: row.course.company.name,
        courseName: row.course.name, startDate: dateOnly(row.startDate), endDate: dateOnly(row.endDate),
        timeText: row.timeText, coachText: row.coachText, instructorsText: row.instructorsText })),
      engagements: engagements.map(row => ({ id: row.id, courseName: row.courseName, coachName: row.coach.name,
        startDate: row.startDate, endDate: row.endDate, startTime: row.startTime, endTime: row.endTime,
        scheduleDates: [...new Set(row.schedules.map(item => dateOnly(item.date)))].sort(),
        scheduleTimes: [...new Map(row.schedules.map(item => [`${item.startTime}-${item.endTime}`, { startTime: item.startTime, endTime: item.endTime }])).values()] }))
    };
  }

  async applyMatches(matches: ReadonlyArray<{ engagementId: string; operationSessionId: string }>): Promise<number> {
    if (!matches.length) return 0;
    return getPrismaClient().$transaction(async (tx: Prisma.TransactionClient) => {
      await lockPrismaCoachCatalog(tx);
      const operationIds = [...new Set(matches.map(item => item.operationSessionId))];
      const active = new Set((await tx.operationSession.findMany({ where: { id: { in: operationIds }, deletedAt: null }, select: { id: true } })).map(row => row.id));
      let updated = 0;
      for (const match of matches) {
        if (!active.has(match.operationSessionId)) continue;
        updated += (await tx.coachEngagement.updateMany({
          where: { id: match.engagementId, operationSessionId: null }, data: { operationSessionId: match.operationSessionId }
        })).count;
      }
      return updated;
    });
  }
}
