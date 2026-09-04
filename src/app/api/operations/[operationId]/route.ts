import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { isSameCourse } from "@/lib/data/operationCalculations";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    operationId: string;
  }>;
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { operationId } = await params;
  const repository = getOperationRepository();
  const operation = await repository.getOperationById(operationId);

  if (!operation) {
    return NextResponse.json({ ok: false, error: "Operation not found." }, { status: 404 });
  }

  const siblingCount = operation.courseId
    ? (await repository.listOperations()).filter((candidate) => isSameCourse(candidate, operation)).length
    : 1;

  if (siblingCount <= 1) {
    return NextResponse.json(
      { ok: false, error: "마지막 회차는 삭제할 수 없습니다. 과정 자체를 지우려면 관리자에게 문의하세요." },
      { status: 400 }
    );
  }

  // 1회차는 지울 수 없다(이혜림님이 정한 규칙). 화면 버튼도 막혀 있지만 여기서도 막는다 —
  // 화면만 막으면 직접 호출로 뚫린다. 정말 그 회차를 없애야 하면 끌어서 아래로 옮긴 뒤 지운다.
  if (operation.roundNo.trim() === "1") {
    return NextResponse.json(
      {
        ok: false,
        error: "1회차는 삭제할 수 없습니다. 이 회차를 없애야 하면 회차 순서를 끌어서 옮긴 뒤 지워주세요."
      },
      { status: 400 }
    );
  }

  await repository.deleteOperation(operationId, session.user?.email ?? undefined);

  return NextResponse.json({ ok: true });
}
