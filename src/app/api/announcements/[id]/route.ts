import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  const prisma = getPrismaClient();
  const row = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      title: true,
      content: true,
      authorName: true,
      authorEmail: true,
      createdAt: true,
      updatedAt: true
    }
  });

  if (!row) {
    return NextResponse.json({ ok: false, error: "공지사항을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    announcement: {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }
  });
}

export async function PUT(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { title?: unknown; content?: unknown };
  const prisma = getPrismaClient();

  const existing = await prisma.announcement.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ ok: false, error: "공지사항을 찾을 수 없습니다." }, { status: 404 });
  }

  const title = stringValue(body.title);
  const content = stringValue(body.content);

  if (!title) {
    return NextResponse.json({ ok: false, error: "제목이 필요합니다." }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ ok: false, error: "내용이 필요합니다." }, { status: 400 });
  }

  const updated = await prisma.announcement.update({
    where: { id },
    data: { title, content },
    select: {
      id: true,
      title: true,
      content: true,
      authorName: true,
      authorEmail: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return NextResponse.json({
    ok: true,
    announcement: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString()
    }
  });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const prisma = getPrismaClient();

  const existing = await prisma.announcement.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ ok: false, error: "공지사항을 찾을 수 없습니다." }, { status: 404 });
  }

  await prisma.announcement.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: session.user?.email ?? null
    }
  });

  return NextResponse.json({ ok: true });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
