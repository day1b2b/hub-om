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
  const session = await requireWorkspaceSession();

  const { operationId } = await params;
  const repository = getOperationRepository();
  const operation = await repository.getOperationById(operationId);

  if (!operation) {
    return NextResponse.json({ ok: false, error: "Operation not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { source?: unknown };
  const source = parseRefreshSource(body.source);
  const requestUserEmail = session.user?.email ?? undefined;
  clearOperationDiscussionCache(operationId, source, { requestUserEmail });
  const collaboration = await readOperationCollaboration(operation, {
    gmailOAuthAccessToken: session.googleAccessToken,
    requestUserEmail
  });
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
