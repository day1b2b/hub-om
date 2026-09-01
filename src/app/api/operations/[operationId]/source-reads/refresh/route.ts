import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import {
  clearOperationDiscussionCache,
  readOperationCollaboration,
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
  // 로그인·워크스페이스 도메인 확인은 그대로 둔다. 세션 값 자체는 더 이상 쓰지 않는다.
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
  const collaboration = await readOperationCollaboration(operation);
  const emailCount = collaboration?.discussionReferences.filter((item) => item.sourceKind === "email").length ?? null;
  const emailCandidateCount = collaboration?.discussionDiagnostics.emailCandidateCount ?? null;
  const emailMatchedCount = collaboration?.discussionDiagnostics.emailMatchedCount ?? emailCount;

  if (collaboration) {
    console.info(
      `[sourceReads:refresh] source=${source} emailCandidates=${emailCandidateCount} emailMatched=${emailMatchedCount} status=${collaboration.discussionStatus} issues=${collaboration.discussionIssues
        .map((issue) => issue.code)
        .join(",")}`
    );
  }

  return NextResponse.json({
    ok: true,
    source,
    emailCount,
    emailCandidateCount,
    emailMatchedCount,
    emailCandidateReferences: collaboration?.discussionEmailCandidates ?? [],
    discussionReferences: collaboration?.discussionReferences ?? [],
    lectureReports: collaboration?.lectureReports ?? [],
    lectureReportStatus: collaboration?.lectureReportStatus,
    status: collaboration?.discussionStatus,
    issueCodes: collaboration?.discussionIssues.map((issue) => issue.code) ?? []
  });
}

function parseRefreshSource(value: unknown): OperationDiscussionRefreshSource {
  if (value === "email" || value === "slack" || value === "all") {
    return value;
  }

  return "all";
}
