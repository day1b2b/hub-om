import { NextResponse } from "next/server.js";
import { denyIfNotAdmin } from "@/lib/auth/apiAdminGuard";
import { getPrismaClient } from "@/lib/data/prisma";
import { activityQuery } from "@/lib/activity/query";
import { legacyWhere, legacyAction } from "@/lib/activity/legacy";
import { describeChanges } from "@/lib/activity/presentation";
import { monitoringRoutes } from "@/lib/activity/usage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await denyIfNotAdmin();
  if (denied) return denied;
  let filters;
  try { filters = activityQuery(new URL(request.url).searchParams); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "조회 조건 오류" }, { status: 400 }); }
  try {
    const prisma = getPrismaClient();
    const orderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];
    const params = new URL(request.url).searchParams;
    if (params.get("source") === "legacy") {
      const where = legacyWhere(params);
      const rows = where ? await prisma.coachContentEntry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, select: { id: true, createdAt: true, authorName: true, authorEmail: true, content: true, sourceField: true, coachId: true, coach: { select: { name: true, deletedAt: true } } } }) : [];
      const entries = rows.slice(0, 50).map(row => ({ id: row.id, occurredAt: row.createdAt, actorName: row.authorName, actorEmail: row.authorEmail, actorType: "user", targetType: "coaches", targetId: row.coachId, targetLabel: row.coach.name, labelSource: "현재 정보", targetHref: row.coach.deletedAt ? null : `/coaches/${row.coachId}`, action: legacyAction(row.content), description: row.content, legacy: true, changes: {}, route: row.sourceField, method: "" }));
      const last = entries.at(-1);
      return NextResponse.json({ entries, nextCursor: rows.length > 50 && last ? `${last.occurredAt.toISOString()}|${last.id}` : null }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const rows = filters.tab === "requests"
      ? await prisma.activityRequest.findMany({ where: { AND: [filters.requests, { route: { notIn: monitoringRoutes } }] }, orderBy, take: 51 })
      : await prisma.activityChange.findMany({ where: filters.changes, orderBy, take: 51 });
    const entries = filters.tab === "requests" ? rows.slice(0, 50) : await describeChanges(prisma, rows.slice(0, 50) as import("@prisma/client").ActivityChange[]);
    const last = entries.at(-1);
    return NextResponse.json({ entries, nextCursor: rows.length > 50 && last ? `${last.occurredAt.toISOString()}|${last.id}` : null }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch {
    return NextResponse.json({ error: "활동 기록을 불러오지 못했습니다. DB 연결과 마이그레이션 적용 상태를 확인하세요." }, { status: 503 });
  }
}
