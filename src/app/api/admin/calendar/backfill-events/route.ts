import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import {
  backfillMissingCalendarEvents,
  deleteBackfilledCalendarEvents,
  type BackfillCalendarOptions
} from "@/lib/googleCalendar/backfillCalendarEvents";

export const dynamic = "force-dynamic";

// 기능 도입 전에 등록돼 캘린더에 올라간 적이 없는 회차를 소급 생성하는 관리자 도구.
// GET    = 미리보기(쓰기 없음) + 파트 캘린더 쓰기 권한 진단. 무엇이 몇 건 빠졌는지 센다.
// POST   = 적용(구글 events.insert + 매핑 저장). 되돌리기 어렵다 — 반드시 GET으로 먼저 확인한다.
// DELETE = 소급으로 만든 이벤트 정리. 명시한 operationIds만 지운다(전체 삭제 없음). 기본 메일 억제.
//
// 공통 쿼리 파라미터:
//   from   = 기준일(YYYY-MM-DD). 이 날짜 이후(포함)에 끝나는 회차만 대상. 미지정 시 오늘(KST).
//            "all"이면 지난 회차까지 전체.
//   limit  = (POST 전용) 한 번에 만들 이벤트 수 상한. 미지정 시 100.
//   notify = (POST·DELETE 전용) "true"면 참석자에게 메일 발송(초대/취소). 미지정 시 억제(sendUpdates=none).
//   operationIds = (DELETE 전용) 정리할 회차 id를 콤마로 구분. 반드시 명시해야 한다.
//
// 경로는 src/auth.ts의 SYNC_API_PATHS에 등록돼 있다(베어러 요청이 로그인 화면으로 리다이렉트되지 않게).

async function activityGET(request: Request) {
  try {
    await requireBackfillAccess(request);

    return NextResponse.json(await backfillMissingCalendarEvents({ dryRun: true, ...parseOptions(request) }));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

async function activityPOST(request: Request) {
  try {
    await requireBackfillAccess(request);

    return NextResponse.json(await backfillMissingCalendarEvents({ dryRun: false, ...parseOptions(request) }));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

async function activityDELETE(request: Request) {
  try {
    await requireBackfillAccess(request);

    const params = new URL(request.url).searchParams;
    const operationIds = (params.get("operationIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (operationIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "operationIds 쿼리가 필요합니다(콤마 구분). 전체 삭제는 지원하지 않습니다." },
        { status: 400 }
      );
    }

    const notifyAttendees = params.get("notify") === "true";
    return NextResponse.json(await deleteBackfilledCalendarEvents(operationIds, { notifyAttendees }));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/** from·limit·notify를 쿼리에서 읽는다. GET·POST 모두 URL 쿼리로 받는다(refresh-events와 같은 결). */
function parseOptions(request: Request): Omit<BackfillCalendarOptions, "dryRun"> {
  const params = new URL(request.url).searchParams;
  const options: Omit<BackfillCalendarOptions, "dryRun"> = {};

  const from = params.get("from")?.trim();
  if (from) options.from = from;

  const limitRaw = params.get("limit")?.trim();
  if (limitRaw) {
    const limit = Number.parseInt(limitRaw, 10);
    if (Number.isFinite(limit) && limit > 0) options.limit = limit;
  }

  if (params.get("notify") === "true") options.notifyAttendees = true;

  return options;
}

/** 서버-투-서버는 SYNC_API_SECRET 베어러, 사람이 여는 경우는 admin 세션으로 허용한다(refresh-events와 같은 규칙). */
async function requireBackfillAccess(request: Request): Promise<string> {
  const configuredSecret = process.env.SYNC_API_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  if (configuredSecret && authorization === `Bearer ${configuredSecret}`) {
    return "sync-api-secret";
  }

  const session = await assertAdminSession();
  return session.user?.email ?? "admin-session";
}

export const GET = withActivity("/api/admin/calendar/backfill-events", "GET", activityGET);

export const POST = withActivity("/api/admin/calendar/backfill-events", "POST", activityPOST);

export const DELETE = withActivity("/api/admin/calendar/backfill-events", "DELETE", activityDELETE);
