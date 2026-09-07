import { withActivity } from "@/lib/activity/request";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { applyCourseNameRestore, CourseNameRestoreConflict, planCourseNameRestore } from "@/lib/data/courseNameRestore";
import { normalizeCourseId } from "@/lib/data/operationCalculations";
import { readLimitedJson, RequestBodyTooLargeError } from "@/lib/http/readLimitedJson";

export const dynamic = "force-dynamic";
const failure = (error: string, status: number) => Response.json({ ok: false, error }, { status });
function validCourseId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && normalizeCourseId(value).length > 0;
}

async function activityGET(request: Request) {
  try { await assertAdminSession(); } catch { return failure("admin 권한이 필요합니다.", 403); }
  const courseId = new URL(request.url).searchParams.get("courseId");
  if (!validCourseId(courseId)) return failure("코스ID를 1~200자로 입력해 주세요.", 400);
  try { return Response.json({ ok: true, plan: await planCourseNameRestore(courseId) }); }
  catch { return failure("복구 계획을 읽지 못했습니다. 잠시 뒤 다시 조회해 주세요.", 500); }
}

async function activityPOST(request: Request) {
  let actorEmail: string | null;
  try { actorEmail = (await assertAdminSession()).user?.email ?? null; }
  catch { return failure("admin 권한이 필요합니다.", 403); }
  let value: unknown;
  try { value = await readLimitedJson(request, 32_768); }
  catch (error) { return failure("올바른 크기와 형식의 JSON 요청이 필요합니다.", error instanceof RequestBodyTooLargeError ? 413 : 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return failure("잘못된 요청입니다.", 400);
  const { courseId, operationIds, snapshot } = value as Record<string, unknown>;
  if (!validCourseId(courseId) || !Array.isArray(operationIds) || operationIds.length < 1 || operationIds.length > 100
    || operationIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 200)
    || new Set(operationIds).size !== operationIds.length || typeof snapshot !== "string" || !/^[a-f0-9]{64}$/.test(snapshot)) {
    return failure("조회한 계획과 중복 없는 1~100개의 회차가 필요합니다.", 400);
  }
  try {
    const result = await applyCourseNameRestore(courseId, operationIds, snapshot, actorEmail);
    return Response.json({ ok: true, result });
  } catch (error) {
    return error instanceof CourseNameRestoreConflict ? failure(error.message, 409)
      : failure("복구하지 못해 전체 작업을 취소했습니다. 다시 조회해 주세요.", 500);
  }
}

export const GET = withActivity("/api/admin/course-name-restore", "GET", activityGET);
export const POST = withActivity("/api/admin/course-name-restore", "POST", activityPOST);
