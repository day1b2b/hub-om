import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";
import type { AnnouncementSummary } from "@/lib/data/announcements/announcementTypes";

export const dynamic = "force-dynamic";

interface AnnouncementWriteBody {
  title?: unknown;
  content?: unknown;
}

export async function GET() {
  await requireWorkspaceSession();

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
  const session = await requireWorkspaceSession();

  const body = (await request.json().catch(() => ({}))) as AnnouncementWriteBody;
  const title = stringValue(body.title);
  const content = stringValue(body.content);

  if (!title) {
    return NextResponse.json({ ok: false, error: "제목이 필요합니다." }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ ok: false, error: "내용이 필요합니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const created = await prisma.announcement.create({
    data: {
      title,
      content,
      authorEmail: session.user?.email ?? "",
      authorName: session.user?.name ?? null
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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
