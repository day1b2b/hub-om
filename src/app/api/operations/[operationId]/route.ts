import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
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
    ? (await repository.listOperations()).filter((candidate) => candidate.courseId === operation.courseId).length
    : 1;

  if (siblingCount <= 1) {
    return NextResponse.json(
      { ok: false, error: "마지막 회차는 삭제할 수 없습니다. 과정 자체를 지우려면 관리자에게 문의하세요." },
      { status: 400 }
    );
  }

  await repository.deleteOperation(operationId, session.user?.email ?? undefined);

  return NextResponse.json({ ok: true });
}
