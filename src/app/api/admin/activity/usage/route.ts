import { denyIfNotAdmin } from "@/lib/auth/apiAdminGuard";
import { getActivityReadRepository } from "@/lib/data/activityReads/activityReadRepositoryFactory";
import { koreaDate, usageFilters } from "@/lib/activity/usage";
import { runActivityReadRequest } from "@/lib/data/activityReadComposition";
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
    const result = await runActivityReadRequest(() => getActivityReadRepository().usage(filters));
    return Response.json({ date, ...result, fetchedAt: new Date().toISOString() }, { headers });
  } catch { return Response.json({ error: "이용 현황을 불러오지 못했습니다." }, { status: 503, headers }); }
}
