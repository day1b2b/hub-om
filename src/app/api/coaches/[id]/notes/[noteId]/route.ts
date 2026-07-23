import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { deleteNote, toggleNoteWarning, updateNote } from "@/lib/coaches/contentEntries";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; noteId: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id, noteId } = await params;
  const author = { email: session.user?.email ?? "", name: session.user?.name ?? session.user?.email ?? "매니저" };

  const body = (await request.json().catch(() => ({}))) as { content?: unknown; toggleWarn?: unknown };

  if (body.toggleWarn === true) {
    const note = await toggleNoteWarning(id, noteId, author);
    return NextResponse.json({ ok: true, note });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ ok: false, error: "메모 내용이 필요합니다." }, { status: 400 });
  }

  const note = await updateNote(id, noteId, content, author);
  return NextResponse.json({ ok: true, note });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id, noteId } = await params;
  const author = { email: session.user?.email ?? "", name: session.user?.name ?? session.user?.email ?? "매니저" };

  await deleteNote(id, noteId, author);
  return NextResponse.json({ ok: true });
}
