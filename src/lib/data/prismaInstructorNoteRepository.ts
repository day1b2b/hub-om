import type { Prisma } from "@prisma/client";
import type {
  InstructorNote,
  InstructorNoteRepository,
  InstructorNotionProfile
} from "./instructorNoteRepository";
import { getPrismaClient } from "./prisma";

// instructor_notes 한 행 → 화면이 쓰는 InstructorNote.
// notion_profile은 노션에서 가져온 JSON 스냅샷이라 그대로 통과시킨다.
type Row = {
  instructorName: string;
  displayName: string | null;
  notionId: string | null;
  partnerId: string | null;
  notes: string | null;
  recruitAvoid: boolean;
  contact: string | null;
  email: string | null;
  notionProfile: Prisma.JsonValue | null;
};

function toNote(row: Row): InstructorNote {
  const note: InstructorNote = { recruitAvoid: row.recruitAvoid };
  if (row.displayName) note.displayName = row.displayName;
  if (row.notionId) note.notionId = row.notionId;
  if (row.partnerId) note.partnerId = row.partnerId;
  if (row.notes) note.notes = row.notes;
  if (row.contact) note.contact = row.contact;
  if (row.email) note.email = row.email;
  if (row.notionProfile && typeof row.notionProfile === "object" && !Array.isArray(row.notionProfile)) {
    note.notion = row.notionProfile as InstructorNotionProfile;
  }
  return note;
}

// patch에 담겨 온 필드만 update에 싣는다. 빠진 필드는 기존 값을 유지해야 하므로 넣지 않는다.
function toUpdateData(patch: InstructorNote): Prisma.InstructorNoteUpdateInput {
  const data: Prisma.InstructorNoteUpdateInput = {};
  if (patch.displayName !== undefined) data.displayName = patch.displayName || null;
  if (patch.notionId !== undefined) data.notionId = patch.notionId || null;
  if (patch.partnerId !== undefined) data.partnerId = patch.partnerId || null;
  if (patch.notes !== undefined) data.notes = patch.notes || null;
  if (patch.recruitAvoid !== undefined) data.recruitAvoid = patch.recruitAvoid;
  if (patch.contact !== undefined) data.contact = patch.contact || null;
  if (patch.email !== undefined) data.email = patch.email || null;
  if (patch.notion !== undefined) {
    data.notionProfile = (patch.notion ?? null) as Prisma.InputJsonValue;
    data.notionSyncedAt = patch.notion?.syncedAt ? new Date(patch.notion.syncedAt) : null;
  }
  return data;
}

const SELECT = {
  instructorName: true,
  displayName: true,
  notionId: true,
  partnerId: true,
  notes: true,
  recruitAvoid: true,
  contact: true,
  email: true,
  notionProfile: true
} as const;

export class PrismaInstructorNoteRepository implements InstructorNoteRepository {
  async getNote(name: string): Promise<InstructorNote> {
    const row = await getPrismaClient().instructorNote.findUnique({
      where: { instructorName: name },
      select: SELECT
    });
    return row ? toNote(row) : {};
  }

  async getAllNotes(): Promise<Record<string, InstructorNote>> {
    const rows = await getPrismaClient().instructorNote.findMany({ select: SELECT });
    const all: Record<string, InstructorNote> = {};
    for (const row of rows) all[row.instructorName] = toNote(row);
    return all;
  }

  async saveNote(name: string, patch: InstructorNote): Promise<InstructorNote> {
    const update = toUpdateData(patch);
    const row = await getPrismaClient().instructorNote.upsert({
      where: { instructorName: name },
      update,
      create: {
        instructorName: name,
        displayName: patch.displayName || null,
        notionId: patch.notionId || null,
        partnerId: patch.partnerId || null,
        notes: patch.notes || null,
        recruitAvoid: patch.recruitAvoid ?? false,
        contact: patch.contact || null,
        email: patch.email || null,
        notionProfile: (patch.notion ?? null) as Prisma.InputJsonValue,
        notionSyncedAt: patch.notion?.syncedAt ? new Date(patch.notion.syncedAt) : null
      },
      select: SELECT
    });
    return toNote(row);
  }
}
