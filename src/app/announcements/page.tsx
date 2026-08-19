import { AnnouncementList } from "@/features/announcements/AnnouncementList";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getPrismaClient } from "@/lib/data/prisma";
import type { AnnouncementSummary } from "@/lib/data/announcements/announcementTypes";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  await requireAdminSession();

  let announcements: AnnouncementSummary[] = [];
  let loadFailed = false;

  try {
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
    announcements = rows.map((row) => ({
      id: row.id,
      title: row.title,
      authorName: row.authorName,
      authorEmail: row.authorEmail,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));
  } catch {
    loadFailed = true;
  }

  return <AnnouncementList announcements={announcements} loadFailed={loadFailed} />;
}
