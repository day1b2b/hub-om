import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { type MultiDealMode, type SalesRevenueSyncResult, runSalesRevenueSync } from "@/lib/data/salesRevenueSync";
import { getSalesRevenueNotifier, getSalesRevenueSource, getSalesRevenueSyncRepository } from "@/lib/data/salesRevenueSyncRepositoryFactory";
import type { SalesRevenueNotifier } from "@/lib/data/salesRevenueSyncRepository";

export const dynamic = "force-dynamic";

/**
 * GET = 미리보기(저장 안 함), POST = 실제 반영.
 * 사람이 화면에서 여는 경우는 admin 세션, 월초 자동 동기화(Coolify 스케줄)는 SYNC_API_SECRET 베어러로 호출한다.
 * 자동 호출(POST)이 실패·미반영이면 SALES_SYNC_ALERT_EMAILS 대상에게 슬랙 DM으로만 알린다(성공은 조용히 넘어간다).
 */
async function activityGET(request: Request) {
  return handle(false, request);
}

async function activityPOST(request: Request) {
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

/** Failed commits may have an unknown outcome; never promise rollback in an error alert. */
function buildFailureText(result: SalesRevenueSyncResult | null, failed = false): string {
  const head = ":chart_with_upwards_trend: 세일즈맵 매출 자동 동기화";
  if (failed) {
    const message = "SALES_REVENUE_SYNC_FAILED";
    return `${head}\n:x: 동기화 중 오류가 발생했습니다. 관리자 화면에서 반영 결과를 확인해 주세요.\n원인: ${message}`;
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

  let notifier: SalesRevenueNotifier | undefined;
  const notify = async (text: string) => { try { await notifier?.notifyFailure(text); } catch { /* Best effort after business decision. */ } };
  try {
    const candidate = getSalesRevenueNotifier();
    // Preflight all scoped services before allowing even a failure notification.
    // Default adapter construction has no database/source side effects.
    getSalesRevenueSyncRepository();
    getSalesRevenueSource();
    notifier = candidate;
    const multiDealResolutions = apply ? await readMultiDealResolutions(request) : {};
    const result = await runSalesRevenueSync({ apply, actorEmail, multiDealResolutions });

    if (!result.configured) {
      if (viaCron && apply) await notify(buildFailureText(result));
      return NextResponse.json(
        { ok: false, error: result.issues[0] ?? "세일즈맵이 설정되지 않았습니다." },
        { status: 400 }
      );
    }

    // 자동 반영인데 partial 등으로 실제 쓰기가 막힌 경우 = 사람이 화면을 안 보므로 알린다.
    if (viaCron && apply && !result.applied) {
      await notify(buildFailureText(result));
    }

    return NextResponse.json({ ok: true, dryRun: !apply, result });
  } catch {
    if (viaCron && apply) await notify(buildFailureText(null, true));
    return NextResponse.json(
      { ok: false, error: "SALES_REVENUE_SYNC_FAILED" },
      { status: 500 }
    );
  }
}

export const GET = withActivity("/api/admin/sales-revenue", "GET", activityGET);

export const POST = withActivity("/api/admin/sales-revenue", "POST", activityPOST);
