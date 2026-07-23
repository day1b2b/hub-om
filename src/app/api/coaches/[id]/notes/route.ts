import { NextResponse } from "next/server";
import { CoachContentEntryKind } from "@prisma/client";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { createNote } from "@/lib/coaches/contentEntries";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();
  const { id } = await params;

  const prisma = getPrismaClient();
  const notes = await prisma.coachContentEntry.findMany({
    where: { coachId: id, kind: CoachContentEntryKind.NOTE, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true, authorName: true, flaggedAt: true, createdAt: true }
  });

  return NextResponse.json({ ok: true, notes });
}

export async function POST(request: Request, { params }: RouteContext) {
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
