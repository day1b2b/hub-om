import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { runLectureFollowUpReminders } from "@/lib/reminders/lectureFollowUpReminder";

export const dynamic = "force-dynamic";

// GET  = 미리보기(발송 안 함). 관리자가 브라우저로 열어 대상과 문구를 확인한다.
// POST = 실제 DM 발송. Coolify 스케줄 작업이 SYNC_API_SECRET 베어러로 호출한다.

export async function GET(request: Request) {
  return reminderJsonResponse(async () => {
    await requireReminderAccess(request);
    return runLectureFollowUpReminders({ dryRun: true });
  });
}

export async function POST(request: Request) {
  return reminderJsonResponse(async () => {
    await requireReminderAccess(request);
    return runLectureFollowUpReminders({ dryRun: false });
  });
}

/** 서버-투-서버는 SYNC_API_SECRET 베어러, 사람이 여는 경우는 admin 세션으로 허용한다. */
async function requireReminderAccess(request: Request): Promise<string> {
  const configuredSecret = process.env.SYNC_API_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  if (configuredSecret && authorization === `Bearer ${configuredSecret}`) {
    return "sync-api-secret";
  }

  const session = await assertAdminSession();
  return session.user?.email ?? "admin-session";
}

async function reminderJsonResponse(handler: () => Promise<unknown>) {
  try {
    return NextResponse.json(await handler());
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
