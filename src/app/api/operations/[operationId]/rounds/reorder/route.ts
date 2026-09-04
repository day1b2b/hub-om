import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { isSameCourse } from "@/lib/data/operationCalculations";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { planRoundReorder } from "@/lib/data/roundReorder";

export const dynamic = "force-dynamic";

// 회차 순서 바꾸기(드래그). 새 순서를 받아 roundNo를 1..N으로 다시 매긴다.
//
// 쓰기 범위를 좁게 고정한다(docs/operations/db-write-safety.md):
//  - 고치는 필드는 roundNo 하나뿐이다. 날짜·강사·만족도는 그 행에 그대로 붙어 함께 움직인다.
//  - 대상은 같은 과정의 회차 전체이고, 번호가 실제로 달라지는 행만 쓴다.
//  - orderedOperationIds가 회차 전체의 순열이 아니면 한 건도 쓰지 않는다.
//  - 누가 무엇을 어떻게 바꿨는지 로그에 남긴다([round-reorder]로 검색).

interface RouteContext {
  params: Promise<{
    operationId: string;
  }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { operationId } = await params;
  const repository = getOperationRepository();
  const baseOperation = await repository.getOperationById(operationId);

  if (!baseOperation) {
    return NextResponse.json({ ok: false, error: "Operation not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { orderedOperationIds?: unknown };
  const orderedOperationIds = Array.isArray(body.orderedOperationIds)
    ? body.orderedOperationIds.filter((value): value is string => typeof value === "string")
    : [];

  const siblings = (await repository.listOperations())
    .filter((candidate) => isSameCourse(candidate, baseOperation))
    .map((candidate) => ({ operationId: candidate.operationId, roundNo: candidate.roundNo }));

  const plan = planRoundReorder(siblings, orderedOperationIds);

  if (!plan.ok) {
    return NextResponse.json({ ok: false, error: plan.error }, { status: 400 });
  }

  if (plan.changes.length === 0) {
    return NextResponse.json({ ok: true, changes: [] });
  }

  try {
    for (const change of plan.changes) {
      await repository.updateOperation(change.operationId, { roundNo: change.toRoundNo });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "회차 순서를 바꾸지 못했습니다.";
    console.error(`[round-reorder] ${operationId} 실패:`, message);

    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  console.info(
    `[round-reorder] ${operationId} 순서 변경 (${session.user?.email ?? "unknown"}): ` +
      plan.changes.map((change) => `${change.fromRoundNo}→${change.toRoundNo}`).join(", ")
  );

  return NextResponse.json({ ok: true, changes: plan.changes });
}
