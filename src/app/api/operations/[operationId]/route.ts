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

  await repository.deleteOperation(operationId, session.user?.email ?? undefined);

  return NextResponse.json({ ok: true });
}
