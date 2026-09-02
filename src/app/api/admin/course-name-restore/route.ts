import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { applyCourseNameRestore, planCourseNameRestore } from "@/lib/data/courseNameRestore";

export const dynamic = "force-dynamic";

/**
 * 과정명 되돌리기 API.
 *
 * GET  ?courseId=263102        → 복구 계획만 읽는다(쓰기 없음).
 * POST { courseId, operationIds } → 고른 세션을 원천 과정명으로 되돌린다.
 *
 * 안전 규칙 (docs/operations/db-write-safety.md):
 *   - admin 전용(assertAdminSession). ADMIN_EMAILS 미설정이면 아무도 통과하지 못한다.
 *   - 수정 필드는 operation_sessions.course_record_id 하나뿐. 물리 삭제·스키마 변경 없음.
 *   - operationIds 를 명시적으로 받는다. "이 코스ID 전부" 같은 서버 판단 일괄 실행은 없다.
 *   - 되돌릴 값은 원천 적재 기록에서만 가져온다(추측 금지).
 *   - 무엇을 어디서 어디로 옮겼는지 응답과 서버 로그에 남긴다.
 */
export async function GET(request: Request) {
  try {
    await assertAdminSession();
  } catch {
    return NextResponse.json({ ok: false, error: "admin 권한이 필요합니다." }, { status: 403 });
  }

  const courseId = new URL(request.url).searchParams.get("courseId")?.trim() ?? "";

  if (!courseId) {
    return NextResponse.json({ ok: false, error: "코스ID를 입력해 주세요." }, { status: 400 });
  }

  try {
    const plan = await planCourseNameRestore(courseId);
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "복구 계획을 읽지 못했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let actorEmail: null | string = null;

  try {
    const session = await assertAdminSession();
    actorEmail = session.user?.email ?? null;
  } catch {
    return NextResponse.json({ ok: false, error: "admin 권한이 필요합니다." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { courseId?: string; operationIds?: unknown };
  const courseId = body.courseId?.trim() ?? "";
  const operationIds = Array.isArray(body.operationIds)
    ? body.operationIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

  if (!courseId) {
    return NextResponse.json({ ok: false, error: "코스ID가 없습니다." }, { status: 400 });
  }

  if (operationIds.length === 0) {
    return NextResponse.json({ ok: false, error: "되돌릴 회차를 하나 이상 선택해 주세요." }, { status: 400 });
  }

  try {
    const result = await applyCourseNameRestore(courseId, operationIds, actorEmail);

    // 운영 데이터를 바꾸는 경로다 — 누가 무엇을 옮겼는지 서버 로그에 남긴다.
    console.info(
      `[course-name-restore] by=${actorEmail ?? "unknown"} courseId=${courseId} ` +
        `moved=${result.moved.length} skipped=${result.skipped.length} ` +
        result.moved.map((item) => `${item.operationId}:"${item.from}"->"${item.to}"`).join(" ")
    );

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "되돌리지 못했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
