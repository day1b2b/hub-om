import { withActivity } from "@/lib/activity/request";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { promoteReadyImportRows } from "@/lib/data/importPromotionService";
import { backfillMissingCalendarEvents } from "@/lib/googleCalendar/backfillCalendarEvents";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

async function activityPOST(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;

  try {
    const result = await promoteReadyImportRows(id);

    // 가져오기(임포트) 승격은 operationSession을 prisma에 직접 만들어 캘린더 반영 래퍼
    // (CalendarReflectingOperationRepository)를 타지 않는다 → 정방향 반영이 안 걸려 캘린더에
    // 안 올라간다. 승격이 커밋된 뒤 메일 없는 소급 반영을 한 번 돌려 조용히 채운다
    // (from=오늘·예정만·교육일 있는 과정만·중복 skip). 정방향 생성처럼 초대 메일을 보내면
    // 대량 임포트 때 메일 폭탄이 되므로 반드시 억제한다(notifyAttendees 기본 false).
    // 캘린더 실패가 이미 커밋된 임포트를 실패로 만들면 안 되므로 격리한다.
    let calendar: { insertedEvents: number; failedOperations: number } | undefined;
    try {
      const backfill = await backfillMissingCalendarEvents({ dryRun: false });
      calendar = {
        insertedEvents: backfill.totals.insertedEvents,
        failedOperations: backfill.totals.failedOperations
      };
    } catch (calendarError) {
      console.error("[import-promote] 캘린더 소급 반영 실패(임포트는 정상 반영됨):", calendarError);
    }

    revalidatePath("/");
    revalidatePath("/operations");
    revalidatePath("/admin/imports");
    revalidatePath(`/admin/imports/${id}`);

    return NextResponse.json({
      ok: true,
      result,
      ...(calendar ? { calendar } : {})
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "반영하지 못했습니다." },
      { status: 400 }
    );
  }
}

export const POST = withActivity("/api/admin/imports/[id]/promote", "POST", activityPOST);
