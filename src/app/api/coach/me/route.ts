import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { extractCoachToken, validateCoachToken } from "@/lib/coaches/coachTokenAuth";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

async function activityGET(request: Request) {
  const coach = await validateCoachToken(extractCoachToken(request));
  if (!coach) {
    return NextResponse.json({ ok: false, error: "코치 정보를 찾을 수 없습니다." }, { status: 401 });
  }

  const prisma = getPrismaClient();
  const [profile, archivedRows] = await Promise.all([
    prisma.coach.findUnique({
      where: { id: coach.id },
      select: {
        fields: { select: { tag: { select: { id: true, name: true } } } },
        curriculums: { select: { tag: { select: { id: true, name: true } } } }
      }
    }),
    prisma.coachdbArchiveRow.findMany({
      where: { snapshot: { status: "completed" }, tableSchema: "public", tableName: "coaches", rowKey: coach.sourceCoachId },
      orderBy: { snapshot: { startedAt: "desc" } }, take: 1, select: { rowData: true }
    })
  ]);

  const archived = (archivedRows[0]?.rowData ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    ok: true,
    coach: {
      id: coach.id,
      name: coach.name,
      status: coach.status.toLowerCase(),
      workType: coach.workType,
      availabilityDetail: stringOrNull(archived.availability_detail),
      fields: profile?.fields.map((field) => ({ id: field.tag.id, name: field.tag.name })) ?? [],
      curriculums: profile?.curriculums.map((curriculum) => ({
        id: curriculum.tag.id,
        name: curriculum.tag.name
      })) ?? []
    }
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export const GET = withActivity("/api/coach/me", "GET", activityGET);
