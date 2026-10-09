import { NextResponse } from "next/server.js";
import { withActivity } from "@/lib/activity/request";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { runOperationWriteRequest } from "@/lib/data/operationWriteComposition";

const fields = ["specialNotes", "operationIssue", "omUpdate"] as const;
async function activityPUT(request: Request, context: { params: Promise<{ operationId: string }> }) {
  const session = await requireWorkspaceSession();
  const operation = await getOperationRepository().getOperationById((await context.params).operationId);
  if (!operation?.courseRecordId) return NextResponse.json({ ok: false, error: "과정을 찾지 못했습니다." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = Object.fromEntries(fields.map(field => [field, typeof body[field] === "string" ? body[field] : ""])) as { specialNotes: string; operationIssue: string; omUpdate: string };
  const note = await runOperationWriteRequest(() => getOperationRepository().upsertCourseCommonNote(operation.courseRecordId!, input, session.user?.email ?? undefined));
  return NextResponse.json({ ok: true, note });
}
export const PUT = withActivity("/api/operations/[operationId]/common-note", "PUT", activityPUT, runOperationWriteRequest);
