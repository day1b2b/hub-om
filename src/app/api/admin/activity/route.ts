import { NextResponse } from "next/server.js";
import { denyIfNotAdmin } from "@/lib/auth/apiAdminGuard";
import { getActivityReadRepository } from "@/lib/data/activityReads/activityReadRepositoryFactory";
import { activityQuery } from "@/lib/activity/query";
import { legacyWhere } from "@/lib/activity/legacy";
import { runActivityReadRequest } from "@/lib/data/activityReadComposition";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await denyIfNotAdmin();
  if (denied) return denied;
  let filters;
  try { filters = activityQuery(new URL(request.url).searchParams); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "조회 조건 오류" }, { status: 400 }); }
  try {
    const params = new URL(request.url).searchParams;
    const result = await runActivityReadRequest(async () => {
      const repository = getActivityReadRepository();
      return params.get("source") === "legacy"
        ? repository.legacyList(legacyWhere(params))
        : repository.adminList(filters);
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "활동 기록을 불러오지 못했습니다. DB 연결과 마이그레이션 적용 상태를 확인하세요." }, { status: 503 });
  }
}
