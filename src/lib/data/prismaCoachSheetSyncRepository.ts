import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import { lockPrismaCoach, lockPrismaCoachCatalog } from "./prismaCoachLock";
import type { CoachSheetSyncReader, CoachSheetSyncRepository, CoachSheetSyncTransaction, SheetEngagementMatch } from "./coachSheetSyncRepository";

const coachSelect = { id: true, name: true, workType: true, privateProfile: { select: { employeeId: true, email: true, phone: true } } } as const;
function reader(client: Prisma.TransactionClient): CoachSheetSyncReader {
  return {
    async findLiveCoachByName(name) {
      const rows = await client.coach.findMany({ where: { name, deletedAt: null }, select: coachSelect });
      return rows.at(-1) ?? null;
    },
    listLiveCoaches: () => client.coach.findMany({ where: { deletedAt: null }, select: coachSelect }),
    getCoach: coachId => client.coach.findFirst({ where: { id: coachId, deletedAt: null }, select: coachSelect }),
    findMatchingEngagement: (match: SheetEngagementMatch) => client.coachEngagement.findFirst({ where: { OR: [
      { sourceEngagementId: match.sourceEngagementId },
      { coachId: match.coachId, courseName: match.courseName, startDate: { lte: match.endDate }, endDate: { gte: match.startDate } }
    ] }, select: { id: true, coachId: true } }),
    async listReservationCoachIdsForEngagements(ids) {
      if (!ids.length) return [];
      const rows = await client.coachDayReservation.findMany({ where: { confirmedEngagementId: { in: ids } }, select: { coachId: true }, distinct: ["coachId"] });
      return rows.map(row => row.coachId);
    },
    listEngagementsByCourseNames: names => client.coachEngagement.findMany({ where: { courseName: { in: names } }, select: { id: true, coachId: true } })
  };
}
function transactionPort(tx: Prisma.TransactionClient): CoachSheetSyncTransaction {
  return {
    ...reader(tx),
    async lockCoaches(ids) { for (const id of [...new Set(ids.map(value => value.toLowerCase()))].sort()) await lockPrismaCoach(tx, id); },
    async createCoach(input) {
      const { privateProfile, ...coach } = input;
      return tx.coach.create({ data: { ...coach, status: "ACTIVE", isActive: true, privateProfile: { create: { ...privateProfile, birthDate: null, affiliation: null } } }, select: coachSelect });
    },
    async patchCoach(coachId, patch) { await tx.coach.update({ where: { id: coachId }, data: patch }); },
    async upsertPrivateProfile(coachId, create, patch) {
      await tx.coachPrivateProfile.upsert({ where: { coachId }, create: { coachId, ...create, birthDate: null, affiliation: null }, update: patch });
    },
    async createEngagement(input) { return tx.coachEngagement.create({ data: input, select: { id: true, coachId: true } }); },
    async patchEngagement(engagementId, input) { await tx.coachEngagement.update({ where: { id: engagementId }, data: input }); },
    async replaceSchedules(engagementId, rows) {
      await tx.coachEngagementSchedule.deleteMany({ where: { engagementId } });
      if (rows.length) await tx.coachEngagementSchedule.createMany({ data: rows });
    },
    async deleteEngagements(ids) {
      await tx.coachEngagementSchedule.deleteMany({ where: { engagementId: { in: ids } } });
      await tx.coachEngagement.deleteMany({ where: { id: { in: ids } } });
    },
    async cancelReservations(entries) {
      const groups = new Map<string, typeof entries>();
      for (const entry of entries) { const group = groups.get(entry.engagementId) ?? []; group.push(entry); groups.set(entry.engagementId, group); }
      for (const [engagementId, group] of groups) await tx.coachDayReservation.updateMany({ where: { cancelledAt: null, OR: group.map(({ coachId, date }) => ({ coachId, date })) }, data: { cancelledAt: new Date(), confirmedEngagementId: engagementId } });
    }
  };
}
export class PrismaCoachSheetSyncRepository implements CoachSheetSyncRepository {
  findLiveCoachByName(name: string) { return reader(getPrismaClient()).findLiveCoachByName(name); }
  listLiveCoaches() { return reader(getPrismaClient()).listLiveCoaches(); }
  getCoach(coachId: string) { return reader(getPrismaClient()).getCoach(coachId); }
  findMatchingEngagement(match: SheetEngagementMatch) { return reader(getPrismaClient()).findMatchingEngagement(match); }
  listReservationCoachIdsForEngagements(ids: string[]) { return reader(getPrismaClient()).listReservationCoachIdsForEngagements(ids); }
  listEngagementsByCourseNames(names: string[]) { return reader(getPrismaClient()).listEngagementsByCourseNames(names); }
  transaction<T>(work: (tx: CoachSheetSyncTransaction) => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
    return getPrismaClient().$transaction(async tx => { await lockPrismaCoachCatalog(tx); return work(transactionPort(tx)); }, options?.timeoutMs ? { timeout: options.timeoutMs } : undefined);
  }
}
