// ②/S2: 노션 코치 페이지 '링크 한 개'로 코치 1명을 위키에 멱등 추가/동기화한다(OM 권한).
// 전체 노션 동기화(/api/admin/sync-notion)는 관리자 전용 그대로 두고, '링크로 한 명'만 OM에 연다.
// withActivity에 runCoachSyncRequest를 compose로 넘겨, 쓰기·요청 감사 모두 라이브 Mongo(COACH_SYNC_BACKEND=mongodb-shadow) 스코프 안에서 돈다.
import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { readLimitedJson, RequestBodyTooLargeError } from "@/lib/http/readLimitedJson";
import { syncOneNotionCoachByLink } from "@/lib/coaches/notionCoachSync";
import { runCoachSyncRequest } from "@/lib/data/coachSyncComposition";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 10_000;

async function activityPOST(request: Request) {
  await requireWorkspaceSession();

  let body: { link?: unknown } | null;
  try {
    body = (await readLimitedJson(request, MAX_BODY_BYTES)) as { link?: unknown } | null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ ok: false, error: "요청이 너무 큽니다." }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }

  const link = typeof body?.link === "string" ? body.link.trim() : "";
  if (!link) {
    return NextResponse.json({ ok: false, error: "노션 실습코치DB 페이지 링크를 붙여넣어 주세요." }, { status: 400 });
  }

  try {
    const result = await syncOneNotionCoachByLink(link);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json(
      { ok: false, error: "코치를 추가하지 못했어요. 노션 실습코치DB의 '페이지 링크'가 맞는지 확인해주세요." },
      { status: 400 }
    );
  }
}

export const POST = withActivity("/api/coaches/add-by-link", "POST", activityPOST, runCoachSyncRequest);
