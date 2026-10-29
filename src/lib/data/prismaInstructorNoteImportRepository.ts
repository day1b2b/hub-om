import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import type { InstructorNote } from "./instructorNoteRepository";
import type { InstructorNoteImportEntry, InstructorNoteImportRepository, InstructorPrivateImportFields } from "./instructorNoteImportRepository";
function text(value: string | undefined): string | undefined { const normalized = value?.trim(); return normalized ? normalized : undefined; }
function updateData(note: InstructorNote, recruitAvoid: boolean): Prisma.InstructorNoteUpdateInput {
  const data: Prisma.InstructorNoteUpdateInput = { recruitAvoid: recruitAvoid || note.recruitAvoid === true };
  if (note.notionNo !== undefined && note.instructorName) data.instructorName = note.instructorName;
  for (const field of ["displayName", "notionId", "partnerId", "notes"] as const) { const value = text(note[field]); if (value !== undefined) data[field] = value; }
  if (note.notion) { data.notionProfile = note.notion as Prisma.InputJsonValue; if (note.notion.syncedAt) data.notionSyncedAt = new Date(note.notion.syncedAt); }
  return data;
}
function toDate(value: string | undefined): Date | null { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
// 암호화 테이블에 넣을 값. 평문으로 넘기면 withPrivacyDatabase가 tx 쓰기를 암호화한다(코치 import와 동일).
function privateProfileData(fields: InstructorPrivateImportFields) {
  return { contact: fields.contact ?? null, contact2: fields.contact2 ?? null, email: fields.email ?? null, email2: fields.email2 ?? null, birthDate: toDate(fields.birthDate) };
}
export class PrismaInstructorNoteImportRepository implements InstructorNoteImportRepository {
  private readonly client: PrismaClient;
  constructor(client: PrismaClient = getPrismaClient()) { this.client = client; }
  async importNotes(entries: readonly InstructorNoteImportEntry[], apply: boolean) {
    try { return await this.client.$transaction(async tx => {
      let inserted = 0, updated = 0;
      for (const { name, note, privateProfile } of entries) {
        const existing = note.notionNo !== undefined
          ? await tx.instructorNote.findUnique({ where: { notionNo: note.notionNo }, select: { id: true, recruitAvoid: true } })
          : await tx.instructorNote.findFirst({ where: { instructorName: name }, orderBy: { notionNo: "asc" }, select: { id: true, recruitAvoid: true } });
        let noteId: string | undefined;
        if (existing) { updated++; if (apply) { await tx.instructorNote.update({ where: { id: existing.id }, data: updateData(note, existing.recruitAvoid) }); noteId = existing.id; } }
        else { inserted++; if (apply) { const created = await tx.instructorNote.create({ select: { id: true }, data: {
          notionNo: note.notionNo ?? null, instructorName: name, displayName: text(note.displayName) ?? null, notionId: text(note.notionId) ?? null, partnerId: text(note.partnerId) ?? null,
          notes: text(note.notes) ?? null, recruitAvoid: note.recruitAvoid === true, notionProfile: (note.notion ?? null) as Prisma.InputJsonValue,
          notionSyncedAt: note.notion?.syncedAt ? new Date(note.notion.syncedAt) : null,
        } }); noteId = created.id; } }
        // 개인정보는 strip된 노트와 별도로 암호화 테이블에 적재(원천 기준 덮어쓰기). apply일 때만, PII가 있을 때만.
        if (apply && noteId && privateProfile) {
          const data = privateProfileData(privateProfile);
          await tx.instructorPrivateProfile.upsert({ where: { instructorNoteId: noteId }, create: { instructorNoteId: noteId, ...data }, update: data });
        }
      }
      return { total: entries.length, inserted, updated };
    }, { isolationLevel: apply ? Prisma.TransactionIsolationLevel.Serializable : Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 30_000 }); }
    catch { throw new Error("INSTRUCTOR_NOTE_IMPORT_FAILED"); }
  }
}
