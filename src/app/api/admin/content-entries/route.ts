import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachContentRepository } from "@/lib/data/coachContentRepositoryFactory";
import { runChangesRequest } from "@/lib/data/changesComposition";

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

async function activityGET() {
  await requireWorkspaceSession();

  const { entries, reviewedEngagements } = await getCoachContentRepository().getContentFeed();

  const noteAndHistoryRows: FeedRow[] = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind === "NOTE" ? "note" : "history",
    coachId: entry.coach.id,
    coachName: entry.coach.name,
    authorOrSource: entry.kind === "NOTE" ? entry.authorName ?? "-" : entry.sourceField ?? "-",
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

export const GET = withActivity("/api/admin/content-entries", "GET", activityGET, runChangesRequest);
