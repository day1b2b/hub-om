import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { type MultiDealMode, runSalesRevenueSync } from "@/lib/data/salesRevenueSync";

export const dynamic = "force-dynamic";

/** GET = 미리보기(저장 안 함), POST = 실제 반영. 둘 다 admin만 허용. */
export async function GET() {
  return handle(false);
}

export async function POST(request: Request) {
  return handle(true, request);
}

const VALID_MODES = new Set(["sum", "max", "min", "exclude"]);

/** 반영(POST) 본문에서 다중 딜 처리 방식 맵을 안전하게 꺼낸다(미리보기 GET엔 없음). */
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

async function handle(apply: boolean, request?: Request) {
  let actorEmail: string;
  try {
    const session = await assertAdminSession();
    actorEmail = session.user?.email ?? "unknown";
  } catch {
    return NextResponse.json({ ok: false, error: "admin 권한이 필요합니다." }, { status: 403 });
  }

  try {
    const multiDealResolutions = apply ? await readMultiDealResolutions(request) : {};
    const result = await runSalesRevenueSync({ apply, actorEmail, multiDealResolutions });

    if (!result.configured) {
      return NextResponse.json(
        { ok: false, error: result.issues[0] ?? "세일즈맵이 설정되지 않았습니다." },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, dryRun: !apply, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
