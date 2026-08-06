import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { runSalesRevenueSync } from "@/lib/data/salesRevenueSync";

export const dynamic = "force-dynamic";

/** GET = 미리보기(저장 안 함), POST = 실제 반영. 둘 다 admin만 허용. */
export async function GET() {
  return handle(false);
}

export async function POST() {
  return handle(true);
}

async function handle(apply: boolean) {
  let actorEmail: string;
  try {
    const session = await assertAdminSession();
    actorEmail = session.user?.email ?? "unknown";
  } catch {
    return NextResponse.json({ ok: false, error: "admin 권한이 필요합니다." }, { status: 403 });
  }

  try {
    const result = await runSalesRevenueSync({ apply, actorEmail });

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
