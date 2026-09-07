import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { type MultiDealMode, type SalesRevenueSyncResult, runSalesRevenueSync } from "@/lib/data/salesRevenueSync";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { sendSlackDirectMessage } from "@/lib/slack/notifySlack";

export const dynamic = "force-dynamic";

/**
 * GET = 미리보기(저장 안 함), POST = 실제 반영.
 * 사람이 화면에서 여는 경우는 admin 세션, 월초 자동 동기화(Coolify 스케줄)는 SYNC_API_SECRET 베어러로 호출한다.
 * 자동 호출(POST)이 실패·미반영이면 SALES_SYNC_ALERT_EMAILS 대상에게 슬랙 DM으로만 알린다(성공은 조용히 넘어간다).
 */
export async function GET(request: Request) {
  return handle(false, request);
}

export async function POST(request: Request) {
  return handle(true, request);
}

const VALID_MODES = new Set(["sum", "max", "min", "exclude"]);

/** 반영(POST) 본문에서 다중 딜 처리 방식 맵을 안전하게 꺼낸다(미리보기 GET·자동 호출엔 없어 {}). */
async function readMultiDealResolutions(request?: Request): Promise<Record<string, MultiDealMode>> {
  if (!request) return {};
  try {
    const body = (await request.json()) as { multiDealResolutions?: unknown };
    const raw = body?.multiDealResolutions;
    if (!raw || typeof raw !== "object") return {};
    const result: Record<string, MultiDealMode> = {};
    for (const [courseId, mode] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof mode === "string" && VALID_MODES.has(mode)) {
        result[courseId] = mode as MultiDealMode;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** 서버-투-서버(월초 스케줄)는 SYNC_API_SECRET 베어러, 사람이 여는 경우는 admin 세션. */
async function requireSalesSyncAccess(request?: Request): Promise<{ actorEmail: string; viaCron: boolean }> {
  const configuredSecret = process.env.SYNC_API_SECRET?.trim();
  const authorization = request?.headers.get("authorization");

  if (configuredSecret && authorization === `Bearer ${configuredSecret}`) {
    return { actorEmail: "sync-api-secret", viaCron: true };
  }

  const session = await assertAdminSession();
  return { actorEmail: session.user?.email ?? "admin-session", viaCron: false };
}

/**
 * 자동 동기화가 실패했을 때만 담당자에게 슬랙 DM. 성공은 알리지 않는다.
 * 대상 = SALES_SYNC_ALERT_EMAILS(쉼표 구분). 비어 있으면 아무에게도 보내지 않는다(안전 기본값).
 * 알림 자체의 실패는 동기화 결과를 가리지 않도록 삼킨다.
 */
async function notifySalesSyncFailure(text: string): Promise<void> {
  const raw = process.env.SALES_SYNC_ALERT_EMAILS?.trim();
  if (!raw) return;
  const targets = raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (targets.length === 0) return;

  try {
    const users = await listTeamUsers();
    for (const email of targets) {
      const user = users.find((candidate) => candidate.email?.trim().toLowerCase() === email);
      if (user?.slackId) {
        await sendSlackDirectMessage(user.slackId, text);
      }
    }
  } catch {
    // 알림 실패는 조용히 넘어간다 — 동기화 결과 자체를 가리면 안 된다.
  }
}

/** 자동 반영 실패/미반영 결과를 사람이 읽을 한 줄로. (기존 매출은 트랜잭션·partial 차단으로 보존된다) */
function buildFailureText(result: SalesRevenueSyncResult | null, error?: unknown): string {
  const head = ":chart_with_upwards_trend: 세일즈맵 매출 자동 동기화";
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `${head}\n:x: 오류로 중단됐어요. 이번 달 매출은 갱신되지 않았습니다(기존 매출은 그대로예요).\n원인: ${message}`;
  }
  if (result && !result.configured) {
    return `${head}\n:warning: 설정 문제로 실행되지 않았어요.\n원인: ${result.issues[0] ?? "세일즈맵 미설정"}`;
  }
  const reason = result?.issues.join(" / ") || "세일즈맵을 일부만 읽어(partial) 반영을 막았습니다(429 등).";
  return `${head}\n:warning: 이번 달 매출을 반영하지 못했어요(기존 매출은 그대로예요).\n원인: ${reason}\n잠시 후 관리자 화면에서 수동으로 다시 시도해 주세요.`;
}

async function handle(apply: boolean, request?: Request) {
  const access = await requireSalesSyncAccess(request).catch(() => null);
  if (!access) {
    return NextResponse.json({ ok: false, error: "admin 권한이 필요합니다." }, { status: 403 });
  }
  const { actorEmail, viaCron } = access;

  try {
    const multiDealResolutions = apply ? await readMultiDealResolutions(request) : {};
    const result = await runSalesRevenueSync({ apply, actorEmail, multiDealResolutions });

    if (!result.configured) {
      if (viaCron && apply) await notifySalesSyncFailure(buildFailureText(result));
      return NextResponse.json(
        { ok: false, error: result.issues[0] ?? "세일즈맵이 설정되지 않았습니다." },
        { status: 400 }
      );
    }

    // 자동 반영인데 partial 등으로 실제 쓰기가 막힌 경우 = 사람이 화면을 안 보므로 알린다.
    if (viaCron && apply && !result.applied) {
      await notifySalesSyncFailure(buildFailureText(result));
    }

    return NextResponse.json({ ok: true, dryRun: !apply, result });
  } catch (error) {
    if (viaCron && apply) await notifySalesSyncFailure(buildFailureText(null, error));
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
