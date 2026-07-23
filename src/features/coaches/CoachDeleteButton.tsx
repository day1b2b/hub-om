"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CoachDeleteButton({ coachId, coachName }: { coachId: string; coachName: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    if (isDeleting) return;
    if (!window.confirm(`${coachName} 코치를 삭제할까요? 삭제 내역에서 복원할 수 있습니다.`)) return;

    setIsDeleting(true);
    const response = await fetch(`/api/coaches/${coachId}`, { method: "DELETE" });
    setIsDeleting(false);

    if (response.ok) router.push("/coaches");
  }

  return (
    <button className="coach-origin-delete-btn" disabled={isDeleting} onClick={handleDelete} type="button">
      {isDeleting ? "삭제 중…" : "삭제"}
    </button>
  );
}
