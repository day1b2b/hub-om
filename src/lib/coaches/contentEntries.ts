import { CoachContentEntryKind } from "@prisma/client";
import { getPrismaClient } from "@/lib/data/prisma";
import { getCoachContentRepository } from "@/lib/data/coachContentRepositoryFactory";
import type { CoachContentAuthor as Author } from "@/lib/data/coachContentRepository";

export async function createNote(coachId: string, content: string, author: Author) {
  return getCoachContentRepository().createNote(coachId, content, author);
}
export async function updateNote(coachId: string, noteId: string, content: string, author: Author) {
  return getCoachContentRepository().updateNote(coachId, noteId, content, author);
}
export async function deleteNote(coachId: string, noteId: string, author: Author) {
  return getCoachContentRepository().deleteNote(coachId, noteId, author);
}
export async function toggleNoteWarning(coachId: string, noteId: string, author: Author) {
  return getCoachContentRepository().toggleNoteWarning(coachId, noteId, author);
}

// These existing PostgreSQL callers deliberately retain the default-database guard.
// Routing them through coachContent would expand the shadow scope to profile/review writes.
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
