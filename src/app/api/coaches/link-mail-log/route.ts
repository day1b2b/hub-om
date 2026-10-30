// 코치별 "최근 안내 메일 작성" 기록(언제·누가). 일정 등록 현황 표의 기록 칸이 읽는다.
// 열람 감사 로그 중 context "link_mail"만 읽으며, 이메일 본문 같은 개인정보는 돌려주지 않는다.
import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { listLatestCoachLinkMails } from "@/lib/data/coachLinkMailLog";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };

async function activityGET() {
  const session = await auth();
  if (!session?.user?.email || !isAllowedWorkspaceEmail(session.user.email)) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401, headers: privateHeaders });
  }
  try {
    const logs = await listLatestCoachLinkMails();
    return NextResponse.json({ ok: true, logs }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ ok: false, error: "메일 작성 기록을 불러오지 못했습니다." }, { status: 500, headers: privateHeaders });
  }
}

export const GET = withActivity("/api/coaches/link-mail-log", "GET", activityGET);
