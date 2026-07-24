import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
    attachmentId: string;
  }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id, attachmentId } = await params;
  const prisma = getPrismaClient();

  const attachment = await prisma.announcementAttachment.findFirst({
    where: { id: attachmentId, announcementId: id, announcement: { deletedAt: null } },
    select: { fileName: true, mimeType: true, data: true }
  });

  if (!attachment) {
    return NextResponse.json({ ok: false, error: "첨부파일을 찾을 수 없습니다." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`
    }
  });
}
