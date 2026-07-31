import { NextResponse } from "next/server";
import { CoachContentEntryKind } from "@prisma/client";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface FeedRow {
  id: string;
  kind: "note" | "review" | "history";
  coachId: string;
  coachName: string;
  authorOrSource: string;
  content: string;
  flagged: boolean;
  createdAt: string;
  rating?: number | null;
  feedback?: string | null;
}

export async function GET() {
  await requireWorkspaceSession();

  const prisma = getPrismaClient();

  const [entries, reviewedEngagements] = await Promise.all([
    prisma.coachContentEntry.findMany({
      where: {
        OR: [
          { kind: CoachContentEntryKind.EDIT_HISTORY },
          { kind: CoachContentEntryKind.NOTE, deletedAt: null }
        ]
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

  const noteAndHistoryRows: FeedRow[] = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind === CoachContentEntryKind.NOTE ? "note" : "history",
    coachId: entry.coach.id,
    coachName: entry.coach.name,
    authorOrSource: entry.kind === CoachContentEntryKind.NOTE ? entry.authorName ?? "-" : entry.sourceField ?? "-",
    content: entry.content,
    flagged: Boolean(entry.flaggedAt),
    createdAt: entry.createdAt.toISOString()
  }));

  const reviewRows: FeedRow[] = reviewedEngagements.map((engagement) => ({
    id: engagement.id,
    kind: "review",
    coachId: engagement.coach.id,
    coachName: engagement.coach.name,
    authorOrSource: engagement.courseName,
    content: engagement.feedback ? `${engagement.feedback} (평점 ${engagement.rating ?? "-"})` : `평점 ${engagement.rating}`,
    flagged: Boolean(engagement.reviewFlaggedAt),
    createdAt: engagement.createdAt.toISOString(),
    rating: engagement.rating,
    feedback: engagement.feedback
  }));

  const rows = [...noteAndHistoryRows, ...reviewRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ ok: true, entries: rows });
}
