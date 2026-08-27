"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RequestActions({ id, isAdmin, isAssigned }: { id: string; isAdmin: boolean; isAssigned: boolean }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const canDelete = isAdmin || !isAssigned;

  async function handleDelete() {
    if (!confirm("이 요청을 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/om-request/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error);
      }
      router.push("/om-request/manage");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error && err.message ? err.message : "삭제에 실패했습니다.");
      setDeleting(false);
    }
  }

  return (
    <div className="request-actions">
      <a className="request-edit-btn" href={`/om-request/manage/${id}/edit`}>수정</a>
      {canDelete ? (
        <button className="request-delete-btn" disabled={deleting} onClick={handleDelete}>
          {deleting ? "삭제 중..." : "삭제"}
        </button>
      ) : null}
    </div>
  );
}
