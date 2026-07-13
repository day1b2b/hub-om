"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteRoundButtonProps {
  fallbackOperationId: string | null;
  isCurrent: boolean;
  operationId: string;
  roundLabel: string;
  teamQuery: string;
}

export function DeleteRoundButton({
  fallbackOperationId,
  isCurrent,
  operationId,
  roundLabel,
  teamQuery
}: DeleteRoundButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <button
      className="session-row-edit-trigger session-row-delete-trigger"
      disabled={isDeleting}
      onClick={handleDelete}
      type="button"
    >
      {isDeleting ? "삭제 중" : "삭제"}
    </button>
  );

  async function handleDelete() {
    if (!confirm(`${roundLabel}를 삭제하시겠습니까? 삭제 후에는 목록에서 보이지 않습니다.`)) return;

    setIsDeleting(true);

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operationId)}`, { method: "DELETE" });
    } catch {
      setIsDeleting(false);
      alert("삭제하지 못했습니다.");
      return;
    }

    if (!response.ok) {
      setIsDeleting(false);
      alert("삭제하지 못했습니다.");
      return;
    }

    if (isCurrent) {
      router.push(fallbackOperationId ? `/operations/${fallbackOperationId}${teamQuery}` : `/operations${teamQuery}`);
    }

    router.refresh();
  }
}
