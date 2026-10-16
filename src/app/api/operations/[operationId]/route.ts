import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { isSameCourse } from "@/lib/data/operationCalculations";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { retryOperationCalendarDelete } from "@/lib/googleCalendar/reflectOperationToCalendar";
import { getDataRepositoryOverride } from "@/lib/data/dataRepositoryContext";
import { planRoundReorder } from "@/lib/data/roundReorder";
import { runOperationWriteRequest } from "@/lib/data/operationWriteComposition";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    operationId: string;
  }>;
}

async function activityDELETE(_request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { operationId } = await params;
  const repository = getOperationRepository();
  const operation = await repository.getOperationById(operationId);

  if (!operation) {
    const scopedCalendar = getDataRepositoryOverride("calendarPersistence");
    const localOnly = !scopedCalendar && (process.env.OPERATION_DATA_SOURCE === "local" || !process.env.DATABASE_URL);
    if (!localOnly) {
      const recovery = await retryOperationCalendarDelete(operationId);
      if (recovery !== "not-found") {
        return NextResponse.json({ ok: true, calendarCleanup: recovery });
      }
    }
    return NextResponse.json({ ok: false, error: "Operation not found." }, { status: 404 });
  }

  // 같은 과정은 Course 내부 ID(courseRecordId)로 센다. 코스ID는 필수가 아니라 비어 있어도 회차가 여러 개일 수 있다.
  // courseRecordId가 없는 외부 원천 항목만 코스ID+과정명+고객사 조합으로 비교한다.
  const siblings = (await repository.listOperations()).filter((candidate) =>
    operation.courseRecordId ? candidate.courseRecordId === operation.courseRecordId : isSameCourse(candidate, operation)
  );
  const siblingCount = siblings.length;

  if (siblingCount <= 1) {
    return NextResponse.json(
      { ok: false, code: "LAST_ROUND", error: "마지막 회차는 삭제할 수 없습니다. 과정 자체를 지우려면 관리자에게 문의하세요." },
      { status: 400 }
    );
  }

  // 1회차는 지울 수 없다(이혜림님이 정한 규칙). 화면 버튼도 막혀 있지만 여기서도 막는다 —
  // 화면만 막으면 직접 호출로 뚫린다. 정말 그 회차를 없애야 하면 끌어서 아래로 옮긴 뒤 지운다.
  // 단, 같은 과정에 "1회차"가 중복 생성된 경우(예: om-request 중복 접수 후 잔존)는
  // 어느 쪽이 "진짜" 1회차인지 구분할 수 없어 이 보호를 적용하지 않는다 — 마지막 남은
  // 1회차까지 지우는 건 위 siblingCount 체크가 그대로 막아준다.
  const firstRoundSiblingCount = siblings.filter((candidate) => candidate.roundNo.trim() === "1").length;

  if (operation.roundNo.trim() === "1" && firstRoundSiblingCount <= 1) {
    return NextResponse.json(
      {
        ok: false,
        code: "FIRST_ROUND",
        error: "1회차는 삭제할 수 없습니다. 이 회차를 없애야 하면 회차 순서를 끌어서 옮긴 뒤 지워주세요."
      },
      { status: 400 }
    );
  }

  await repository.deleteOperation(operationId, session.user?.email ?? undefined);

  // 삭제로 남은 과정 회차에 구멍이 생기지 않도록, 현재 roundNo 순서를 그대로 1..N으로 다시 매긴다.
  // (드래그 순서 바꾸기와 같은 planRoundReorder를 재사용 — 결과가 다르면 안 바뀐 것처럼 보이는 행동 불일치를 막는다)
  const remainingSiblings = siblings
    .filter((candidate) => candidate.operationId !== operationId)
    .map((candidate) => ({ operationId: candidate.operationId, roundNo: candidate.roundNo }))
    .sort((a, b) => Number(a.roundNo) - Number(b.roundNo));

  const renumberPlan = planRoundReorder(
    remainingSiblings,
    remainingSiblings.map((sibling) => sibling.operationId)
  );

  if (renumberPlan.ok) {
    try {
      for (const change of renumberPlan.changes) {
        await repository.updateOperation(change.operationId, { roundNo: change.toRoundNo });
      }
    } catch {
      console.error("[round-delete] ROUND_RENUMBER_FAILED", { operationId });
    }
  }

  return NextResponse.json({ ok: true });
}

export const DELETE = withActivity("/api/operations/[operationId]", "DELETE", activityDELETE, runOperationWriteRequest);
