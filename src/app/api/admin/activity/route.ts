import { NextResponse } from "next/server.js";
import { denyIfNotAdmin } from "@/lib/auth/apiAdminGuard";
import { getPrismaClient } from "@/lib/data/prisma";
import { activityQuery } from "@/lib/activity/query";
import { withActivity } from "@/lib/activity/request";

export const dynamic = "force-dynamic";

async function activityGET(request: Request) {
  const denied = await denyIfNotAdmin();
  if (denied) return denied;
  let filters;
  try { filters = activityQuery(new URL(request.url).searchParams); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "조회 조건 오류" }, { status: 400 }); }
  try {
    const prisma = getPrismaClient();
    const orderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];
    const rows = filters.tab === "requests"
      ? await prisma.activityRequest.findMany({ where: filters.requests, orderBy, take: 51 })
      : await prisma.activityChange.findMany({ where: filters.changes, orderBy, take: 51 });
    const entries = rows.slice(0, 50);
    const last = entries.at(-1);
    return NextResponse.json({ entries, nextCursor: rows.length > 50 && last ? `${last.occurredAt.toISOString()}|${last.id}` : null }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch {
    return NextResponse.json({ error: "활동 기록을 불러오지 못했습니다. DB 연결과 마이그레이션 적용 상태를 확인하세요." }, { status: 503 });
  }
}

export const GET = withActivity("/api/admin/activity", "GET", activityGET);
