import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachContentRepository } from "@/lib/data/coachContentRepositoryFactory";
import { runChangesRequest } from "@/lib/data/changesComposition";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    yearMonth: string;
  }>;
}

async function activityGET(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { yearMonth } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    return NextResponse.json({ ok: false, error: "월 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const { activeCoaches, accessLogs } = await getCoachContentRepository().getScheduleStatus(yearMonth);

  const logMap = new Map(accessLogs.map((log) => [log.coachId, log]));
  const notAccessedCoaches: Array<{ id: string; name: string }> = [];
  const accessedOnlyCoaches: Array<{ id: string; name: string }> = [];
  const completedCoaches: Array<{ id: string; name: string }> = [];

  for (const coach of activeCoaches) {
    const log = logMap.get(coach.id);
    if (!log) {
      notAccessedCoaches.push(coach);
    } else if (!log.lastEditedAt) {
      accessedOnlyCoaches.push(coach);
    } else {
      completedCoaches.push(coach);
    }
  }

  return NextResponse.json({
    ok: true,
    yearMonth,
    status: {
      notAccessed: notAccessedCoaches.length,
      accessedOnly: accessedOnlyCoaches.length,
      completed: completedCoaches.length
    },
    notAccessedCoaches,
    accessedOnlyCoaches,
    completedCoaches
  });
}

export const GET = withActivity("/api/schedules/[yearMonth]/status", "GET", activityGET, runChangesRequest);
