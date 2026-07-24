"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import type { AnnouncementSummary } from "@/lib/data/announcements/announcementTypes";

interface AnnouncementListProps {
  announcements: AnnouncementSummary[];
  loadFailed: boolean;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function AnnouncementList({ announcements, loadFailed }: AnnouncementListProps) {
  const router = useRouter();

  const total = announcements.length;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="공지사항" teamScope="both" />
      <section className="content operations-page announcements-content">
        <header className="page-header">
          <div>
            <h1>공지사항</h1>
          </div>
          <Link className="user-add-btn" href="/announcements/new">
            새 공지 작성
          </Link>
        </header>

        {loadFailed ? (
          <p className="user-empty">공지사항을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        ) : announcements.length === 0 ? (
          <p className="user-empty">등록된 공지사항이 없습니다.</p>
        ) : (
          <table className="user-table">
            <colgroup>
              <col style={{ width: "10%" }} />
              <col style={{ width: "50%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>번호</th>
                <th>제목</th>
                <th>작성자</th>
                <th>등록일</th>
              </tr>
            </thead>
            <tbody>
              {announcements.map((item, index) => (
                <tr key={item.id} onClick={() => router.push(`/announcements/${item.id}`)}>
                  <td>{total - index}</td>
                  <td>{item.title}</td>
                  <td>{item.authorName || item.authorEmail}</td>
                  <td>{formatDate(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
