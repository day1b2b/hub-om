import { getActivityReadRepository } from "@/lib/data/activityReads/activityReadRepositoryFactory";
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
    const result = await getActivityReadRepository().feed(filters);
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: "활동 기록 저장소를 확인할 수 없습니다." }, { status: 503, headers });
  }
}
