import { NextResponse } from "next/server";
import { CoachStatus } from "@prisma/client";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { buildSkillfloCoachUrl } from "@/lib/coaches/skillfloCoachUrl";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    yearMonth: string;
  }>;
}

export type ScheduleRegistrationStatus = "completed" | "accessedOnly" | "notAccessed";

export async function GET(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { yearMonth } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    return NextResponse.json({ ok: false, error: "월 형식이 올바르지 않습니다." }, { status: 400 });
  }

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

  const logMap = new Map(accessLogs.map((log) => [log.coachId, log]));

  const rows = coaches.map((coach) => {
    const log = logMap.get(coach.id);
    const status: ScheduleRegistrationStatus = !log ? "notAccessed" : !log.lastEditedAt ? "accessedOnly" : "completed";

    return {
      id: coach.id,
      name: coach.name,
      workType: coach.workType,
      coachInputUrl: buildSkillfloCoachUrl(coach.accessToken),
      status
    };
  });

  const counts = {
    completed: rows.filter((row) => row.status === "completed").length,
    accessedOnly: rows.filter((row) => row.status === "accessedOnly").length,
    notAccessed: rows.filter((row) => row.status === "notAccessed").length,
    total: rows.length
  };

  return NextResponse.json({ ok: true, yearMonth, counts, coaches: rows });
}
