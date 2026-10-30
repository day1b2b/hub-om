// 코치 일정 입력 링크 안내 메일 "메일 쓰기" 버튼. 그 코치 이메일 1건을 열람해 돌려주고, 열람 감사 로그에
// context "link_mail"로 남긴다(= 안내 메일 작성 기록). 메일 발송은 하지 않는다(누른 사람이 Gmail에서 보냄).
// 권한·감사 방식은 /api/pii/reveal과 같다(워크스페이스 로그인 전원 + 전수 감사). 데이터 repo 전환이 없어 composition은 걸지 않는다.
import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { revealCoachEmailForLinkMail } from "@/lib/data/piiReveal";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function activityPOST(_request: Request, { params }: RouteContext) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !isAllowedWorkspaceEmail(email)) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401, headers: privateHeaders });
  }
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: "코치 ID가 올바르지 않습니다." }, { status: 400, headers: privateHeaders });
  }
  try {
    const value = await revealCoachEmailForLinkMail(id.toLowerCase(), email);
    return NextResponse.json({ ok: true, email: value, at: new Date().toISOString() }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ ok: false, error: "이메일을 불러오지 못했습니다." }, { status: 500, headers: privateHeaders });
  }
}

export const POST = withActivity("/api/coaches/[id]/link-mail", "POST", activityPOST);
