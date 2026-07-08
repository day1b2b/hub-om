import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { searchOperationDriveFolders } from "@/lib/driveImports/googleDriveOperationScanner";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    operationId: string;
  }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { operationId } = await params;
  const repository = getOperationRepository();
  const operation = await repository.getOperationById(operationId);

  if (!operation) {
    return NextResponse.json({ ok: false, error: "Operation not found." }, { status: 404 });
  }

  const result = await searchOperationDriveFolders(operation);

  return NextResponse.json({ ok: true, result });
}
