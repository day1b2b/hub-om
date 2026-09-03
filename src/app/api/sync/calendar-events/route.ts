import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { planCalendarReverseSync } from "@/lib/googleCalendar/calendarReverseSync";
import { applyCalendarReverseSync } from "@/lib/googleCalendar/applyCalendarReverseSync";

export const dynamic = "force-dynamic";

// 구글 캘린더 → 운영현황 역반영.
// GET = 계획 미리보기(쓰기 없음), POST = 적용(운영현황 날짜·시간 쓰기 + 캘린더 원복·재생성).
// 경로를 src/auth.ts의 SYNC_API_PATHS에도 등록해야 베어러 요청이 로그인 화면으로
// 리다이렉트되지 않는다(마무리 알림에서 겪은 사고).

export async function GET(request: Request) {
  try {
    await requireCalendarSyncAccess(request);

    return NextResponse.json(await planCalendarReverseSync());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireCalendarSyncAccess(request);

    return NextResponse.json(await applyCalendarReverseSync());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/** 서버-투-서버는 SYNC_API_SECRET 베어러, 사람이 여는 경우는 admin 세션으로 허용한다. */
async function requireCalendarSyncAccess(request: Request): Promise<string> {
  const configuredSecret = process.env.SYNC_API_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  if (configuredSecret && authorization === `Bearer ${configuredSecret}`) {
    return "sync-api-secret";
  }

  const session = await assertAdminSession();
  return session.user?.email ?? "admin-session";
}
