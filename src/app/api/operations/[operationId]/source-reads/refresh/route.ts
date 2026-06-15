import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import {
  clearOperationDiscussionCache,
  type OperationDiscussionRefreshSource
} from "@/lib/data/operationCollaboration";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

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

  const body = (await request.json().catch(() => ({}))) as { source?: unknown };
  const source = parseRefreshSource(body.source);
  clearOperationDiscussionCache(operationId, source);

  return NextResponse.json({ ok: true, source });
}

function parseRefreshSource(value: unknown): OperationDiscussionRefreshSource {
  if (value === "email" || value === "slack" || value === "all") {
    return value;
  }

  return "all";
}
