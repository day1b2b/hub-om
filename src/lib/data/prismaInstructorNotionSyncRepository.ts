import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import type { InstructorNotionMatch, InstructorNotionRecord, InstructorNotionSyncRepository } from "./instructorNotionSyncRepository";

const select = { id: true, recruitAvoid: true, instructorName: true } as const;

/** Preserve the original PG read/update sequence; Mongo's row transaction is a separate guarantee. */
export class PrismaInstructorNotionSyncRepository implements InstructorNotionSyncRepository {
  initialize(): void { getPrismaClient(); }

  async findMatch({ notionNo, name }: InstructorNotionRecord): Promise<InstructorNotionMatch> {
    const prisma = getPrismaClient();
    const existing = await prisma.instructorNote.findUnique({ where: { notionNo }, select });
    if (existing) return { target: existing, by: "notionNo" };
    const legacy = await prisma.instructorNote.findFirst({ where: { instructorName: name, notionNo: null }, select });
    return { target: legacy, by: legacy ? "legacy" : "none" };
  }

  async applyRecord(record: InstructorNotionRecord): Promise<"created" | "updated"> {
    const prisma = getPrismaClient();
    const { target } = await this.findMatch(record);
    const { name, notionNo, note } = record;
    const data = {
      notionNo,
      instructorName: name,
      ...(note.notionId ? { notionId: note.notionId } : {}),
      recruitAvoid: (target?.recruitAvoid ?? false) || (note.recruitAvoid ?? false),
      notionProfile: (note.notion ?? null) as Prisma.InputJsonValue,
      notionSyncedAt: note.notion?.syncedAt ? new Date(note.notion.syncedAt) : null
    };
    if (target) {
      await prisma.instructorNote.update({ where: { id: target.id }, data });
      return "updated";
    }
    await prisma.instructorNote.create({ data });
    return "created";
  }
}
