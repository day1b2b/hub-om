import { CoachContentEntryKind, CoachStatus } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import type { CoachContentAuthor, CoachContentRepository } from "./coachContentRepository";

function summarize(content: string, maxLength = 40): string {
  const trimmed = content.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

/** Default PostgreSQL backend; preserves the original helpers and route queries. */
export class PrismaCoachContentRepository implements CoachContentRepository {
  async createNote(coachId: string, content: string, author: CoachContentAuthor) {
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

  async updateNote(coachId: string, noteId: string, content: string, author: CoachContentAuthor) {
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

  async deleteNote(coachId: string, noteId: string, author: CoachContentAuthor) {
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

  async toggleNoteWarning(coachId: string, noteId: string, author: CoachContentAuthor) {
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

  async listNotes(coachId: string) {
    const prisma = getPrismaClient();
    return prisma.coachContentEntry.findMany({
      where: { coachId, kind: CoachContentEntryKind.NOTE, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true, authorName: true, flaggedAt: true, createdAt: true }
    });
  }
  async getContentFeed() {
    const prisma = getPrismaClient();

    const [entries, reviewedEngagements] = await Promise.all([
      prisma.coachContentEntry.findMany({
        where: {
          kind: CoachContentEntryKind.NOTE, deletedAt: null
        },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: {
          id: true,
          kind: true,
          content: true,
          authorName: true,
          sourceField: true,
          flaggedAt: true,
          createdAt: true,
          coach: { select: { id: true, name: true } }
        }
      }),
      prisma.coachEngagement.findMany({
        where: { OR: [{ rating: { not: null } }, { feedback: { not: null } }] },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: {
          id: true,
          rating: true,
          feedback: true,
          courseName: true,
          createdAt: true,
          reviewFlaggedAt: true,
          coach: { select: { id: true, name: true } }
        }
      })
    ]);
    return { entries, reviewedEngagements };
  }
  async getScheduleRegistration(yearMonth: string) {
    const prisma = getPrismaClient();
    const [coaches, accessLogs] = await Promise.all([
      prisma.coach.findMany({
        where: { status: CoachStatus.ACTIVE, deletedAt: null },
        select: { id: true, name: true, workType: true, accessToken: true },
        orderBy: { normalizedName: "asc" }
      }),
      prisma.coachScheduleAccessLog.findMany({
        where: { yearMonth },
        select: { coachId: true, lastEditedAt: true }
      })
    ]);
    return { coaches, accessLogs };
  }
  async getScheduleStatus(yearMonth: string) {
    const prisma = getPrismaClient();
    const [activeCoaches, accessLogs] = await Promise.all([
      prisma.coach.findMany({
        where: {
          status: CoachStatus.ACTIVE,
          deletedAt: null
        },
        select: { id: true, name: true },
        orderBy: { normalizedName: "asc" }
      }),
      prisma.coachScheduleAccessLog.findMany({
        where: { yearMonth },
        select: { coachId: true, accessedAt: true, lastEditedAt: true }
      })
    ]);
    return { activeCoaches, accessLogs };
  }
}
