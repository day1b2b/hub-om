import { AnnouncementList } from "@/features/announcements/AnnouncementList";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getAnnouncementRepository } from "@/lib/data/announcements/announcementRepositoryFactory";
import type { AnnouncementSummary } from "@/lib/data/announcements/announcementTypes";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  await requireAdminSession();

  let announcements: AnnouncementSummary[] = [];
  let loadFailed = false;

  try {
    const repository = getAnnouncementRepository();
    const rows = await repository.list();
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
