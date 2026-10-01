import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { getAnnouncementRepository } from "@/lib/data/announcements/announcementRepositoryFactory";
import { AnnouncementForm } from "@/features/announcements/AnnouncementForm";
import { runAnnouncementRequest } from "@/lib/data/announcementComposition";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AnnouncementEditPage({ params }: Props) {
  await requireAdminSession();
  const { id } = await params;

  const announcement = await runAnnouncementRequest(() => getAnnouncementRepository().getEditPage(id));

  if (!announcement) notFound();

  return (
    <main className="dashboard-shell">
      <AppSidebar label="공지사항" teamScope="both" />
      <section className="content operations-page">
        <header className="page-header">
          <div>
            <div className="detail-breadcrumb">
              <Link href="/announcements">공지사항</Link>
              <span>›</span>
              <span>수정</span>
            </div>
            <h1>공지사항 수정</h1>
          </div>
        </header>
        <AnnouncementForm
          announcementId={announcement.id}
          initialAttachments={announcement.attachments}
          initialContent={announcement.content}
          initialTitle={announcement.title}
          mode="edit"
        />
      </section>
    </main>
  );
}
