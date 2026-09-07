import { getPrismaClient } from "@/lib/data/prisma";
import { authorizeActivityFeed, feedQuery } from "@/lib/activity/feed";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const status = authorizeActivityFeed(request.headers);
  if (status !== 200) return Response.json({ error: status === 503 ? "활동 조회 연결이 설정되지 않았습니다." : "조회 인증에 실패했습니다." }, { status, headers });
  let filters;
  try { filters = feedQuery(new URL(request.url).searchParams); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "조회 조건 오류" }, { status: 400, headers }); }
  try {
    const prisma = getPrismaClient();
    const result = await prisma.$transaction(async tx => {
      const orderBy = [{ occurredAt: "desc" as const }, { id: "desc" as const }];
      const rows = filters.list.tab === "requests"
        ? await tx.activityRequest.findMany({ where: filters.list.requests, orderBy, take: 51 })
        : await tx.activityChange.findMany({ where: filters.list.changes, orderBy, take: 51 });
      const entries = rows.slice(0, 50);
      const last = entries.at(-1);
      let summary;
      if (filters.includeSummary) {
        const where = filters.summary.requests;
        const [requests, changes, errors, users] = await Promise.all([
          tx.activityRequest.count({ where }),
          tx.activityChange.count({ where: filters.summary.changes }),
          tx.activityRequest.count({ where: { AND: [where, { status: { gte: 400 } }] } }),
          tx.activityRequest.groupBy({ by: ["actorEmail"], where: { AND: [where, { actorEmail: { not: null } }] } })
        ]);
        summary = { requests, changes, errors, users: users.length };
      }
      return { entries, nextCursor: rows.length > 50 && last ? `${last.occurredAt.toISOString()}|${last.id}` : null, summary, fetchedAt: new Date().toISOString() };
    }, { isolationLevel: "RepeatableRead", timeout: 8000, maxWait: 2000 });
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: "활동 기록 저장소를 확인할 수 없습니다." }, { status: 503, headers });
  }
}
