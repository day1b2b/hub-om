import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { refreshCalendarEventTexts } from "@/lib/googleCalendar/refreshCalendarEventTexts";

export const dynamic = "force-dynamic";

// 캘린더 이벤트의 설명·제목을 현재 규칙으로 일괄 갱신하는 관리자 도구.
// GET = 대상 미리보기(쓰기 없음), POST = 적용(구글 patch만, DB 쓰기 없음, 참석자 메일 없음).
// 문구·제목 규칙을 바꾼 배포 뒤 한 번 실행한다. 경로는 src/auth.ts의 SYNC_API_PATHS에 등록돼 있다.

export async function GET(request: Request) {
  try {
    await requireRefreshAccess(request);

    return NextResponse.json(await refreshCalendarEventTexts({ dryRun: true }));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireRefreshAccess(request);

    return NextResponse.json(await refreshCalendarEventTexts({ dryRun: false }));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/** 서버-투-서버는 SYNC_API_SECRET 베어러, 사람이 여는 경우는 admin 세션으로 허용한다(calendar-events와 같은 규칙). */
async function requireRefreshAccess(request: Request): Promise<string> {
  const configuredSecret = process.env.SYNC_API_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  if (configuredSecret && authorization === `Bearer ${configuredSecret}`) {
    return "sync-api-secret";
  }

  const session = await assertAdminSession();
  return session.user?.email ?? "admin-session";
}
