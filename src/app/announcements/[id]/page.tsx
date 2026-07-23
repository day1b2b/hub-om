import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";
import { AnnouncementActions } from "@/features/announcements/AnnouncementActions";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AnnouncementDetailPage({ params }: Props) {
  await requireWorkspaceSession();
  const { id } = await params;

  const prisma = getPrismaClient();
  const announcement = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      title: true,
      content: true,
      authorName: true,
      authorEmail: true,
      createdAt: true
    }
  });

  if (!announcement) notFound();

  const createdAt = announcement.createdAt.toISOString().slice(0, 10);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="공지사항" teamScope="both" />
      <section className="content operations-page">
        <header className="page-header">
          <div>
            <div className="detail-breadcrumb">
              <Link href="/announcements">공지사항</Link>
              <span>›</span>
              <span>{announcement.title}</span>
            </div>
            <h1>{announcement.title}</h1>
            <p className="page-subtitle">
              {announcement.authorName || announcement.authorEmail} · 등록일 {createdAt}
            </p>
          </div>
          <AnnouncementActions id={announcement.id} />
        </header>

        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{announcement.content}</div>
      </section>
    </main>
  );
}
