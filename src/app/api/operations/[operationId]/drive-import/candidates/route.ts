import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { scanOperationDriveFolder } from "@/lib/driveImports/googleDriveOperationScanner";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    operationId: string;
  }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { operationId } = await params;
  const repository = getOperationRepository();
  const operation = await repository.getOperationById(operationId);

  if (!operation) {
    return NextResponse.json({ ok: false, error: "Operation not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { folderUrl?: unknown };
  const folderUrl = typeof body.folderUrl === "string" && body.folderUrl.trim() ? body.folderUrl.trim() : operation.driveLink;

  if (!folderUrl) {
    return NextResponse.json(
      { ok: false, error: "Drive 폴더 URL을 입력해 주세요." },
      { status: 400 }
    );
  }

  const result = await scanOperationDriveFolder(folderUrl);

  return NextResponse.json({ ok: true, result });
}
