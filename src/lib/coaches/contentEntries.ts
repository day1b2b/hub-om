import { CoachContentEntryKind } from "@prisma/client";
import { getPrismaClient } from "@/lib/data/prisma";

interface Author {
  email: string;
  name: string;
}

function summarize(content: string, maxLength = 40): string {
  const trimmed = content.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

export async function createNote(coachId: string, content: string, author: Author) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const note = await tx.coachContentEntry.create({
      data: {
        coachId,
        kind: CoachContentEntryKind.NOTE,
        content,
        authorEmail: author.email,
        authorName: author.name
      }
    });

    await tx.coachContentEntry.create({
      data: {
        coachId,
        kind: CoachContentEntryKind.EDIT_HISTORY,
        content: `메모 작성: ${summarize(content)}`,
        authorEmail: author.email,
        authorName: author.name,
        sourceField: "coach_content_entries.note"
      }
    });

    return note;
  });
}

export async function updateNote(coachId: string, noteId: string, content: string, author: Author) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const note = await tx.coachContentEntry.update({
      where: { id: noteId, coachId },
      data: { content }
    });

    await tx.coachContentEntry.create({
      data: {
        coachId,
        kind: CoachContentEntryKind.EDIT_HISTORY,
        content: `메모 수정: ${summarize(content)}`,
        authorEmail: author.email,
        authorName: author.name,
        sourceField: "coach_content_entries.note"
      }
    });

    return note;
  });
}

export async function deleteNote(coachId: string, noteId: string, author: Author) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const note = await tx.coachContentEntry.update({
      where: { id: noteId, coachId },
      data: { deletedAt: new Date() }
    });

    await tx.coachContentEntry.create({
      data: {
        coachId,
        kind: CoachContentEntryKind.EDIT_HISTORY,
        content: `메모 삭제: ${summarize(note.content)}`,
        authorEmail: author.email,
        authorName: author.name,
        sourceField: "coach_content_entries.note"
      }
    });

    return note;
  });
}

export async function toggleNoteWarning(coachId: string, noteId: string, author: Author) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.coachContentEntry.findUniqueOrThrow({ where: { id: noteId, coachId } });
    const nextFlaggedAt = existing.flaggedAt ? null : new Date();

    const note = await tx.coachContentEntry.update({
      where: { id: noteId, coachId },
      data: { flaggedAt: nextFlaggedAt }
    });

    await tx.coachContentEntry.create({
      data: {
        coachId,
        kind: CoachContentEntryKind.EDIT_HISTORY,
        content: nextFlaggedAt ? `메모 경고 설정: ${summarize(note.content)}` : `메모 경고 해제: ${summarize(note.content)}`,
        authorEmail: author.email,
        authorName: author.name,
        sourceField: "coach_content_entries.note"
      }
    });

    return note;
  });
}

export async function logReviewEdit(coachId: string, engagementId: string, summary: string, author: Author) {
  const prisma = getPrismaClient();
  await prisma.coachContentEntry.create({
    data: {
      coachId,
      kind: CoachContentEntryKind.EDIT_HISTORY,
      content: summary,
      authorEmail: author.email,
      authorName: author.name,
      sourceField: `coach_engagements.review:${engagementId}`
    }
  });
}

export async function logProfileEdit(coachId: string, changedFields: string[], author: Author) {
  if (changedFields.length === 0) return;

  const prisma = getPrismaClient();
  await prisma.coachContentEntry.create({
    data: {
      coachId,
      kind: CoachContentEntryKind.EDIT_HISTORY,
      content: `프로필 수정: ${changedFields.join(", ")}`,
      authorEmail: author.email,
      authorName: author.name,
      sourceField: `coaches.${changedFields.join(",")}`
    }
  });
}
