import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getAnnouncementRepository } from "@/lib/data/announcements/announcementRepositoryFactory";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
    attachmentId: string;
  }>;
}

async function activityGET(_request: Request, { params }: RouteContext) {
  await assertAdminSession();

  const { id, attachmentId } = await params;
  const repository = getAnnouncementRepository();

  const attachment = await repository.download(id, attachmentId);

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

export const GET = withActivity("/api/announcements/[id]/attachments/[attachmentId]", "GET", activityGET);
