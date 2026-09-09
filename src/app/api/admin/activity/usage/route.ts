import { denyIfNotAdmin } from "@/lib/auth/apiAdminGuard";
import { getPrismaClient } from "@/lib/data/prisma";
import { koreaDate, usageFilters } from "@/lib/activity/usage";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const denied = await denyIfNotAdmin();
  if (denied) return denied;
  const date = new URL(request.url).searchParams.get("date") ?? koreaDate();
  let filters;
  try { filters = usageFilters(date); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "날짜 오류" }, { status: 400, headers }); }
  try {
    const result = await getPrismaClient().$transaction(async tx => {
      const [requests, errors, automatedRequests, changes, users] = await Promise.all([
        tx.activityRequest.count({ where: filters.human }),
        tx.activityRequest.count({ where: { AND: [filters.human, { status: { gte: 400 } }] } }),
        tx.activityRequest.count({ where: filters.automated }),
        tx.activityChange.count({ where: { occurredAt: filters.occurredAt, actorType: "user" } }),
        tx.activityRequest.groupBy({ by: ["actorEmailPiiIndex"], where: { AND: [filters.human, { actorEmail: { not: null } }] }, _count: { _all: true } })
      ]);
      return { requests, errors, automatedRequests, changes, users: users.length };
    }, { isolationLevel: "RepeatableRead", timeout: 8000 });
    return Response.json({ date, ...result, fetchedAt: new Date().toISOString() }, { headers });
  } catch { return Response.json({ error: "이용 현황을 불러오지 못했습니다." }, { status: 503, headers }); }
}
