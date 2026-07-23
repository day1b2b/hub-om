import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";
import { AnnouncementForm } from "@/features/announcements/AnnouncementForm";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AnnouncementEditPage({ params }: Props) {
  await requireWorkspaceSession();
  const { id } = await params;

  const prisma = getPrismaClient();
  const announcement = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, title: true, content: true }
  });

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
          initialContent={announcement.content}
          initialTitle={announcement.title}
          mode="edit"
        />
      </section>
    </main>
  );
}
