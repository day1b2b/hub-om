import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { extractCoachToken } from "@/lib/coaches/coachTokenAuth";
import { getCoachTokenRepository } from "@/lib/data/coachTokenRepositoryFactory";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
async function activityGET(request: Request) {
  const token = extractCoachToken(request);
  const coach = token ? await getCoachTokenRepository().getOwnProfile(token) : null;
  if (!coach) return NextResponse.json({ ok: false, error: "코치 정보를 찾을 수 없습니다." }, { status: 401, headers: privateHeaders });
  return NextResponse.json({ ok: true, coach }, { headers: privateHeaders });
}
export const GET = withActivity("/api/coach/me", "GET", activityGET);
