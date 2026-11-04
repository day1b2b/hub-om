// 강사 계약 진행상태(시트 요청·발송 + 모두싸인 서명) 스냅샷 동기화. 읽기 전용 — 모두싸인·시트에 쓰지 않는다.
// GET  = 마지막 동기화 요약(관리자 확인용, 외부 호출 없음).
// POST = 지금 동기화. Coolify 예약 작업(08:00·12:00)이 SYNC_API_SECRET 베어러로 호출한다(src/auth.ts SYNC_API_PATHS).
// 데이터 repository를 쓰지 않으므로 withActivity에 composition을 걸지 않는다(calendar/refresh-events와 동형).
import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { readSigningSnapshot, runSigningSync } from "@/lib/instructors/instructorContractSigningSnapshot";

export const dynamic = "force-dynamic";

async function activityGET(request: Request) {
  return syncJsonResponse(async () => {
    await requireSigningSyncAccess(request);
    const snapshot = readSigningSnapshot();
    if (!snapshot) return { ok: true, synced: false };
    const summaries = Object.values(snapshot.entries).flatMap((entry) => (entry.signing ? [entry.signing] : []));
    return {
      ok: true,
      synced: true,
      syncedAt: snapshot.syncedAt,
      modusignSynced: snapshot.modusignSynced,
      contractCount: Object.keys(snapshot.entries).length,
      signingMatched: summaries.length
    };
  });
}

async function activityPOST(request: Request) {
  return syncJsonResponse(async () => {
    await requireSigningSyncAccess(request);
    return runSigningSync();
  });
}

/** 서버-투-서버는 SYNC_API_SECRET 베어러, 사람이 여는 경우는 admin 세션으로 허용한다. */
async function requireSigningSyncAccess(request: Request): Promise<string> {
  const configuredSecret = process.env.SYNC_API_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  if (configuredSecret && authorization === `Bearer ${configuredSecret}`) {
    return "sync-api-secret";
  }

  const session = await assertAdminSession();
  return session.user?.email ?? "admin-session";
}

async function syncJsonResponse(handler: () => Promise<unknown>) {
  try {
    return NextResponse.json(await handler());
  } catch {
    // 시트·모두싸인 오류 문구에 비공개 값이 섞일 수 있어 간단히만 안내한다.
    console.error("[instructor-contract-signing] 동기화 실패");
    return NextResponse.json({ ok: false, error: "강사 계약 진행상태를 동기화하지 못했습니다." }, { status: 500 });
  }
}

export const GET = withActivity("/api/sync/instructor-contract-signing", "GET", activityGET);

export const POST = withActivity("/api/sync/instructor-contract-signing", "POST", activityPOST);
