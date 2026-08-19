import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { runSalesRevenueSync } from "@/lib/data/salesRevenueSync";

export const dynamic = "force-dynamic";

/** GET = 미리보기(저장 안 함), POST = 실제 반영. 둘 다 admin만 허용. */
export async function GET() {
  return handle(false);
}

export async function POST(request: Request) {
  return handle(true, request);
}

/** 반영(POST) 본문에서 제외할 코스ID 목록을 안전하게 꺼낸다(미리보기 GET엔 없음). */
async function readExcludeCourseIds(request?: Request): Promise<string[]> {
  if (!request) return [];
  try {
    const body = (await request.json()) as { excludeCourseIds?: unknown };
    if (!Array.isArray(body?.excludeCourseIds)) return [];
    return body.excludeCourseIds.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
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
    const excludeCourseIds = apply ? await readExcludeCourseIds(request) : [];
    const result = await runSalesRevenueSync({ apply, actorEmail, excludeCourseIds });

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
