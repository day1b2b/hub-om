import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getPrismaClient } from "@/lib/data/prisma";
import type { AnnouncementSummary } from "@/lib/data/announcements/announcementTypes";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_COUNT } from "@/lib/data/announcements/announcementAttachmentLimits";
import { announcementContentToPlainText, sanitizeAnnouncementContent } from "@/lib/data/announcements/sanitizeAnnouncementContent";

export const dynamic = "force-dynamic";

export async function GET() {
  await assertAdminSession();

  const prisma = getPrismaClient();
  const rows = await prisma.announcement.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      authorName: true,
      authorEmail: true,
      createdAt: true,
      updatedAt: true
    }
  });

  const announcements: AnnouncementSummary[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    authorName: row.authorName,
    authorEmail: row.authorEmail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }));

  return NextResponse.json({ ok: true, announcements });
}

export async function POST(request: Request) {
  const session = await assertAdminSession();

  const formData = await request.formData();
  const title = stringValue(formData.get("title"));
  const rawContent = stringValue(formData.get("content"));
  const content = rawContent ? sanitizeAnnouncementContent(rawContent) : null;
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

  if (!title) {
    return NextResponse.json({ ok: false, error: "제목이 필요합니다." }, { status: 400 });
  }
  if (!content || !announcementContentToPlainText(content)) {
    return NextResponse.json({ ok: false, error: "내용이 필요합니다." }, { status: 400 });
  }
  if (files.length > MAX_ATTACHMENT_COUNT) {
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

  const prisma = getPrismaClient();
  const created = await prisma.announcement.create({
    data: {
      title,
      content,
      authorEmail: session.user?.email ?? "",
      authorName: session.user?.name ?? null,
      attachments: { create: attachmentsData }
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

  return NextResponse.json(
    {
      ok: true,
      announcement: {
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString()
      }
    },
    { status: 201 }
  );
}

function stringValue(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
