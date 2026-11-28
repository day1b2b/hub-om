// ②/S1: 운영현황 회차의 코치 투입(CoachEngagement)을 'OM이 위키에서 ID로 고른 집합'으로 맞춘다.
// 입력의 정본은 coachId 참조다. coachText(표시·호환)는 기존 저장 경로(drive-import/apply)가 쓰고,
// 이 라우트는 그와 같은 선택에서 나온 coachId로 engagement를 라이브 Mongo에 멱등 반영한다(백필과 같은 키 → 수렴).
import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { readLimitedJson, RequestBodyTooLargeError } from "@/lib/http/readLimitedJson";
import { getSessionCoachSyncRepository } from "@/lib/data/sessionCoachSyncRepositoryFactory";
import { runSessionCoachSyncWriteRequest } from "@/lib/data/sessionCoachSyncWriteComposition";

export const dynamic = "force-dynamic";

const MAX_COACHES = 50;
const MAX_BODY_BYTES = 100_000;

interface RouteContext {
  params: Promise<{ operationId: string }>;
}

async function activityPOST(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  let body: { coachIds?: unknown } | null;
  try {
    body = (await readLimitedJson(request, MAX_BODY_BYTES)) as { coachIds?: unknown } | null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ ok: false, error: "요청이 너무 큽니다." }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }

  const { operationId } = await params;
  const raw = Array.isArray(body?.coachIds) ? body.coachIds : [];
  // 위키에서 고른 coachId만. 중복 제거. (자유 입력 폐지 — 목록 밖 값은 프론트가 보내지 않는다.)
  const coachIds = [...new Set(raw.filter((value): value is string => typeof value === "string" && value.length > 0))];
  if (coachIds.length > MAX_COACHES) {
    return NextResponse.json({ ok: false, error: `코치는 한 번에 ${MAX_COACHES}명까지 선택할 수 있습니다.` }, { status: 413 });
  }

  try {
    // 라이브 Mongo 경로로만 쓴다(OPERATION_WRITE_BACKEND=mongodb-shadow). Postgres 직접쓰기 금지.
    const result = await runSessionCoachSyncWriteRequest(() =>
      getSessionCoachSyncRepository().setSessionCoaches(operationId, coachIds, new Date())
    );
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ ok: false, error: "코치 투입 반영에 실패했습니다. 다시 시도해 주세요." }, { status: 500 });
  }
}

export const POST = withActivity("/api/operations/[operationId]/coaches", "POST", activityPOST);
