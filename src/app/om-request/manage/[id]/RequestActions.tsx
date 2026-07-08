"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RequestActions({ id }: { id: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("이 요청을 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/om-request/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.push("/om-request/manage");
      router.refresh();
    } catch {
      alert("삭제에 실패했습니다.");
      setDeleting(false);
    }
  }

  return (
    <div className="request-actions">
      <a className="request-edit-btn" href={`/om-request/manage/${id}/edit`}>수정</a>
      <button className="request-delete-btn" disabled={deleting} onClick={handleDelete}>
        {deleting ? "삭제 중..." : "삭제"}
      </button>
    </div>
  );
}
