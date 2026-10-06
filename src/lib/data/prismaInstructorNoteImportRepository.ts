import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import type { InstructorNote } from "./instructorNoteRepository";
import type { InstructorNoteImportEntry, InstructorNoteImportRepository } from "./instructorNoteImportRepository";
function text(value: string | undefined): string | undefined { const normalized = value?.trim(); return normalized ? normalized : undefined; }
function updateData(note: InstructorNote, recruitAvoid: boolean): Prisma.InstructorNoteUpdateInput {
  const data: Prisma.InstructorNoteUpdateInput = { recruitAvoid: recruitAvoid || note.recruitAvoid === true };
  if (note.notionNo !== undefined && note.instructorName) data.instructorName = note.instructorName;
  for (const field of ["displayName", "notionId", "partnerId", "notes"] as const) { const value = text(note[field]); if (value !== undefined) data[field] = value; }
  if (note.notion) { data.notionProfile = note.notion as Prisma.InputJsonValue; if (note.notion.syncedAt) data.notionSyncedAt = new Date(note.notion.syncedAt); }
  return data;
}
export class PrismaInstructorNoteImportRepository implements InstructorNoteImportRepository {
  private readonly client: PrismaClient;
  constructor(client: PrismaClient = getPrismaClient()) { this.client = client; }
  async importNotes(entries: readonly InstructorNoteImportEntry[], apply: boolean) {
    try { return await this.client.$transaction(async tx => {
      let inserted = 0, updated = 0;
      for (const { name, note } of entries) {
        const existing = note.notionNo !== undefined
          ? await tx.instructorNote.findUnique({ where: { notionNo: note.notionNo }, select: { id: true, recruitAvoid: true } })
          : await tx.instructorNote.findFirst({ where: { instructorName: name }, orderBy: { notionNo: "asc" }, select: { id: true, recruitAvoid: true } });
        if (existing) { updated++; if (apply) await tx.instructorNote.update({ where: { id: existing.id }, data: updateData(note, existing.recruitAvoid) }); }
        else { inserted++; if (apply) await tx.instructorNote.create({ data: {
          notionNo: note.notionNo ?? null, instructorName: name, displayName: text(note.displayName) ?? null, notionId: text(note.notionId) ?? null, partnerId: text(note.partnerId) ?? null,
          notes: text(note.notes) ?? null, recruitAvoid: note.recruitAvoid === true, notionProfile: (note.notion ?? null) as Prisma.InputJsonValue,
          notionSyncedAt: note.notion?.syncedAt ? new Date(note.notion.syncedAt) : null,
        } }); }
      }
      return { total: entries.length, inserted, updated };
    }, { isolationLevel: apply ? Prisma.TransactionIsolationLevel.Serializable : Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 30_000 }); }
    catch { throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED"); }
  }
}
