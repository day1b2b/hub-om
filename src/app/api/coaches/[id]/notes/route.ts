import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { createNote } from "@/lib/coaches/contentEntries";
import { getCoachContentRepository } from "@/lib/data/coachContentRepositoryFactory";
import { runChangesRequest } from "@/lib/data/changesComposition";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function activityGET(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();
  const { id } = await params;

  const notes = await getCoachContentRepository().listNotes(id);

  return NextResponse.json({ ok: true, notes });
}

async function activityPOST(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ ok: false, error: "메모 내용이 필요합니다." }, { status: 400 });
  }

  const author = { email: session.user?.email ?? "", name: session.user?.name ?? session.user?.email ?? "매니저" };
  const note = await createNote(id, content, author);

  return NextResponse.json({ ok: true, note });
}

export const GET = withActivity("/api/coaches/[id]/notes", "GET", activityGET, runChangesRequest);

export const POST = withActivity("/api/coaches/[id]/notes", "POST", activityPOST, runChangesRequest);
