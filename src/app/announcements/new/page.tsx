import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
import { AnnouncementForm } from "@/features/announcements/AnnouncementForm";

export const dynamic = "force-dynamic";

export default async function AnnouncementCreatePage() {
  await requireAdminSession();

  return (
    <main className="dashboard-shell">
      <AppSidebar label="공지사항" teamScope="both" />
      <section className="content operations-page">
        <header className="page-header">
          <div>
            <div className="detail-breadcrumb">
              <Link href="/announcements">공지사항</Link>
              <span>›</span>
              <span>새 공지 작성</span>
            </div>
            <h1>새 공지 작성</h1>
          </div>
        </header>
        <AnnouncementForm mode="create" />
      </section>
    </main>
  );
}
