import { NextResponse } from "next/server";
import { extractCoachToken, validateCoachToken } from "@/lib/coaches/coachTokenAuth";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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
    prisma.$queryRaw<Array<{ row_data: Record<string, unknown> | null }>>`
      SELECT ar.row_data
      FROM coachdb_archive_rows ar
      JOIN coachdb_archive_snapshots s ON s.id = ar.snapshot_id
      WHERE s.status = 'completed'
        AND ar.table_schema = 'public'
        AND ar.table_name = 'coaches'
        AND ar.row_key = ${coach.sourceCoachId}
      ORDER BY s.started_at DESC
      LIMIT 1
    `
  ]);

  const archived = archivedRows[0]?.row_data ?? {};

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
