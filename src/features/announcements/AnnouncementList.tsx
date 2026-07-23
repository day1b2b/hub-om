"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { AnnouncementSummary } from "@/lib/data/announcements/announcementTypes";

interface AnnouncementListProps {
  announcements: AnnouncementSummary[];
  loadFailed: boolean;
}

function formatDateTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

export function AnnouncementList({ announcements, loadFailed }: AnnouncementListProps) {
  const router = useRouter();
  const [items, setItems] = useState<AnnouncementSummary[]>(announcements);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: string, title: string) {
    if (!confirm(`"${title}" 공지사항을 삭제하시겠습니까?`)) return;

    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/announcements/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "삭제 실패");
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="dashboard-shell">
      <AppSidebar label="공지사항" teamScope="both" />
      <section className="content operations-page">
        <header className="page-header">
          <div>
            <h1>공지사항</h1>
            <p className="page-subtitle">기업교육 운영 관련 공지를 등록하고 관리합니다.</p>
          </div>
          <Link className="user-add-btn" href="/announcements/new">
            새 공지 작성
          </Link>
        </header>

        {error && <p className="om-request-error">{error}</p>}

        {loadFailed ? (
          <p className="user-empty">공지사항을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        ) : items.length === 0 ? (
          <p className="user-empty">등록된 공지사항이 없습니다.</p>
        ) : (
          <table className="user-table">
            <thead>
              <tr>
                <th>제목</th>
                <th>작성자</th>
                <th>작성일</th>
                <th>수정일</th>
                <th aria-label="관리" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} onClick={() => router.push(`/announcements/${item.id}/edit`)}>
                  <td className="td-left">{item.title}</td>
                  <td>{item.authorName || item.authorEmail}</td>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{formatDateTime(item.updatedAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="user-delete-btn"
                      disabled={deletingId === item.id}
                      onClick={() => handleDelete(item.id, item.title)}
                      type="button"
                    >
                      {deletingId === item.id ? "삭제 중..." : "삭제"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
