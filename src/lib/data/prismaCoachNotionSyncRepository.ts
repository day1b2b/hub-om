import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import { lockPrismaCoach, lockPrismaCoachCatalog } from "./prismaCoachLock";
import type { CoachNotionSyncReader, CoachNotionSyncRepository, CoachNotionSyncTransaction, NotionSyncCoach } from "./coachNotionSyncRepository";
const include = { privateProfile: true, fields: { include: { tag: true } }, curriculums: { include: { tag: true } } } as const;
type Row = Prisma.CoachGetPayload<{ include: typeof include }>;
function dto(row: Row): NotionSyncCoach {
  return { id: row.id, name: row.name, normalizedName: row.normalizedName, createdAt: row.createdAt,
    employeeNo: row.employeeNo, notionNo: row.notionNo, notionPageId: row.notionPageId, workType: row.workType,
    portfolioUrl: row.portfolioUrl, selfNote: row.selfNote, availabilityDetail: row.availabilityDetail,
    privateProfile: row.privateProfile ? { employeeId: row.privateProfile.employeeId, phone: row.privateProfile.phone, email: row.privateProfile.email, birthDate: row.privateProfile.birthDate, affiliation: row.privateProfile.affiliation } : null,
    fields: row.fields.map(field => field.tag.name), curriculums: row.curriculums.map(field => field.tag.name) };
}
function reader(client: Prisma.TransactionClient): CoachNotionSyncReader {
  return {
    async findByNotionNo(notionNo) { const row = await client.coach.findFirst({ where: { notionNo }, include }); return row ? dto(row) : null; },
    async listByNormalizedName(normalizedName) { return (await client.coach.findMany({ where: { normalizedName }, include, orderBy: { createdAt: "asc" } })).map(dto); }
  };
}
function port(tx: Prisma.TransactionClient): CoachNotionSyncTransaction {
  return { ...reader(tx),
    async lockCoaches(ids) { for (const id of [...new Set(ids.map(value => value.toLowerCase()))].sort()) await lockPrismaCoach(tx, id); },
    async createCoach(input) { await tx.coach.create({ data: { ...input, status: "ACTIVE", isActive: true } }); },
    async patchCoach(id, patch) { await tx.coach.update({ where: { id }, data: patch }); },
    async upsertPrivateProfile(coachId, create, patch) { await tx.coachPrivateProfile.upsert({ where: { coachId }, create: { coachId, ...create }, update: patch }); },
    async replaceTags(coachId, kind, names) {
      if (kind === "fields") {
        await tx.coachField.deleteMany({ where: { coachId } });
        for (const name of names) { const tag = await tx.coachFieldMaster.upsert({ where: { name }, create: { name }, update: {} }); await tx.coachField.create({ data: { coachId, tagId: tag.id } }); }
      } else {
        await tx.coachCurriculum.deleteMany({ where: { coachId } });
        for (const name of names) { const tag = await tx.coachCurriculumMaster.upsert({ where: { name }, create: { name }, update: {} }); await tx.coachCurriculum.create({ data: { coachId, tagId: tag.id } }); }
      }
    }
  };
}
export class PrismaCoachNotionSyncRepository implements CoachNotionSyncRepository {
  findByNotionNo(notionNo: number) { return reader(getPrismaClient()).findByNotionNo(notionNo); }
  listByNormalizedName(normalizedName: string) { return reader(getPrismaClient()).listByNormalizedName(normalizedName); }
  transaction<T>(work: (tx: CoachNotionSyncTransaction) => Promise<T>): Promise<T> {
    return getPrismaClient().$transaction(async tx => { await lockPrismaCoachCatalog(tx); return work(port(tx)); });
  }
}
