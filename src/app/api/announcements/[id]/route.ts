import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_COUNT } from "@/lib/data/announcements/announcementAttachmentLimits";
import { announcementContentToPlainText, sanitizeAnnouncementContent } from "@/lib/data/announcements/sanitizeAnnouncementContent";

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
      updatedAt: true,
      attachments: {
        select: { id: true, fileName: true, mimeType: true, size: true },
        orderBy: { createdAt: "asc" }
      }
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
  const formData = await request.formData();
  const prisma = getPrismaClient();

  const existing = await prisma.announcement.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, _count: { select: { attachments: true } } }
  });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ ok: false, error: "공지사항을 찾을 수 없습니다." }, { status: 404 });
  }

  const title = stringValue(formData.get("title"));
  const rawContent = stringValue(formData.get("content"));
  const content = rawContent ? sanitizeAnnouncementContent(rawContent) : null;
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  const removeAttachmentIds = formData.getAll("removeAttachmentIds").filter((entry): entry is string => typeof entry === "string");

  if (!title) {
    return NextResponse.json({ ok: false, error: "제목이 필요합니다." }, { status: 400 });
  }
  if (!content || !announcementContentToPlainText(content)) {
    return NextResponse.json({ ok: false, error: "내용이 필요합니다." }, { status: 400 });
  }
  const remainingCount = existing._count.attachments - removeAttachmentIds.length + files.length;
  if (remainingCount > MAX_ATTACHMENT_COUNT) {
    return NextResponse.json({ ok: false, error: `첨부파일은 최대 ${MAX_ATTACHMENT_COUNT}개까지 가능합니다.` }, { status: 400 });
  }
  const oversized = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
  if (oversized) {
    return NextResponse.json({ ok: false, error: `${oversized.name} 파일은 5MB 이하만 첨부할 수 있습니다.` }, { status: 400 });
  }

  const attachmentsData = await Promise.all(
    files.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data: Buffer.from(await file.arrayBuffer())
    }))
  );

  const updated = await prisma.announcement.update({
    where: { id },
    data: {
      title,
      content,
      attachments: {
        deleteMany: removeAttachmentIds.length ? { id: { in: removeAttachmentIds } } : undefined,
        create: attachmentsData
      }
    },
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
