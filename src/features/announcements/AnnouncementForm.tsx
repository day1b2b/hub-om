"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_COUNT } from "@/lib/data/announcements/announcementAttachmentLimits";

interface ExistingAttachment {
  id: string;
  fileName: string;
  size: number;
}

interface AnnouncementFormProps {
  mode: "create" | "edit";
  announcementId?: string;
  initialTitle?: string;
  initialContent?: string;
  initialAttachments?: ExistingAttachment[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function AnnouncementForm({
  mode,
  announcementId,
  initialTitle = "",
  initialContent = "",
  initialAttachments = []
}: AnnouncementFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [existingAttachments, setExistingAttachments] = useState(initialAttachments);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachmentCount = existingAttachments.length + selectedFiles.length;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    if (attachmentCount + files.length > MAX_ATTACHMENT_COUNT) {
      setError(`첨부파일은 최대 ${MAX_ATTACHMENT_COUNT}개까지 가능합니다.`);
      return;
    }
    const oversized = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      setError(`${oversized.name} 파일은 5MB 이하만 첨부할 수 있습니다.`);
      return;
    }

    setError(null);
    setSelectedFiles((prev) => [...prev, ...files]);
  }

  function removeSelectedFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function removeExistingAttachment(id: string) {
    setExistingAttachments((prev) => prev.filter((file) => file.id !== id));
    setRemovedAttachmentIds((prev) => [...prev, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const url = mode === "create" ? "/api/announcements" : `/api/announcements/${announcementId}`;
      const method = mode === "create" ? "POST" : "PUT";

      const formData = new FormData();
      formData.append("title", title.trim());
      formData.append("content", content.trim());
      selectedFiles.forEach((file) => formData.append("files", file));
      removedAttachmentIds.forEach((id) => formData.append("removeAttachmentIds", id));

      const res = await fetch(url, { method, body: formData });
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

      <div className="announcement-attachment-field">
        <label className="announcement-attachment-label" htmlFor="announcement-files">
          첨부파일 (최대 {MAX_ATTACHMENT_COUNT}개, 개당 5MB 이하)
        </label>
        <input
          disabled={attachmentCount >= MAX_ATTACHMENT_COUNT}
          id="announcement-files"
          multiple
          onChange={handleFileChange}
          type="file"
        />

        {(existingAttachments.length > 0 || selectedFiles.length > 0) && (
          <ul className="announcement-attachment-list">
            {existingAttachments.map((file) => (
              <li key={file.id}>
                <span>{file.fileName} ({formatFileSize(file.size)})</span>
                <button type="button" onClick={() => removeExistingAttachment(file.id)}>
                  삭제
                </button>
              </li>
            ))}
            {selectedFiles.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                <span>{file.name} ({formatFileSize(file.size)})</span>
                <button type="button" onClick={() => removeSelectedFile(index)}>
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="om-request-error">{error}</p>}
      <button className="user-add-btn" disabled={saving} type="submit" style={{ alignSelf: "flex-start" }}>
        {saving ? "저장 중..." : mode === "create" ? "등록" : "수정 저장"}
      </button>
    </form>
  );
}
