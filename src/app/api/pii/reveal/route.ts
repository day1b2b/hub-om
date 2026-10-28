// 개인정보 단일 필드 열람(마스킹→클릭 열람). 워크스페이스 로그인 전원 허용하되 열람을 감사 로그로
// 남긴다(팀 결정 b). 대량 export(admin 전용)와 다른 경로다. 한 요청에 (entity,id,field) 한 필드만.
// 데이터 repo 전환이 없으므로 withActivity composition은 걸지 않는다(시트 라우트와 동일 패턴).
import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { isRevealableField, revealPiiField } from "@/lib/data/piiReveal";

export const dynamic = "force-dynamic";

async function activityPOST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !isAllowedWorkspaceEmail(email)) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  let entity: unknown;
  let id: unknown;
  let field: unknown;
  try {
    const body = (await request.json()) as { entity?: unknown; id?: unknown; field?: unknown };
    entity = body.entity;
    id = body.id;
    field = body.field;
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (typeof id !== "string" || !id || !isRevealableField(entity, field)) {
    return NextResponse.json({ ok: false, error: "열람할 수 없는 항목입니다." }, { status: 400 });
  }

  try {
    const value = await revealPiiField(entity, id, field as string, email);
    return NextResponse.json({ ok: true, value });
  } catch {
    return NextResponse.json({ ok: false, error: "열람에 실패했습니다." }, { status: 500 });
  }
}

export const POST = withActivity("/api/pii/reveal", "POST", activityPOST);
