"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface AnnouncementFormProps {
  mode: "create" | "edit";
  announcementId?: string;
  initialTitle?: string;
  initialContent?: string;
}

export function AnnouncementForm({ mode, announcementId, initialTitle = "", initialContent = "" }: AnnouncementFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const url = mode === "create" ? "/api/announcements" : `/api/announcements/${announcementId}`;
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim() })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "저장 실패");
      }
      router.push("/announcements");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="user-management" onSubmit={handleSubmit}>
      <input
        required
        className="user-input"
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목"
        style={{ width: "100%" }}
        type="text"
        value={title}
      />
      <textarea
        required
        className="user-bulk-textarea"
        onChange={(e) => setContent(e.target.value)}
        placeholder="내용"
        rows={12}
        value={content}
      />
      {error && <p className="om-request-error">{error}</p>}
      <button className="user-add-btn" disabled={saving} type="submit" style={{ alignSelf: "flex-start" }}>
        {saving ? "저장 중..." : mode === "create" ? "등록" : "수정 저장"}
      </button>
    </form>
  );
}
