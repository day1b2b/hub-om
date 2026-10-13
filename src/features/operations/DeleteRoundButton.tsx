"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteRoundButtonProps {
  fallbackOperationId: string | null;
  isCurrent: boolean;
  isFirstRound: boolean;
  isLastRound: boolean;
  operationId: string;
  roundLabel: string;
  teamQuery: string;
}

export function DeleteRoundButton({
  fallbackOperationId,
  isCurrent,
  isFirstRound,
  isLastRound,
  operationId,
  roundLabel,
  teamQuery
}: DeleteRoundButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  if (isLastRound) {
    return (
      <button
        className="session-row-edit-trigger session-row-delete-trigger"
        disabled
        title="마지막 회차는 삭제할 수 없습니다. 과정 자체를 지우려면 관리자에게 문의하세요."
        type="button"
      >
        삭제 불가
      </button>
    );
  }

  if (isFirstRound) {
    return (
      <button
        className="session-row-edit-trigger session-row-delete-trigger"
        disabled
        title="1회차는 삭제할 수 없습니다."
        type="button"
      >
        삭제 불가
      </button>
    );
  }

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
      const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
      alert(deleteFailureMessage(body?.code));
      return;
    }

    if (isCurrent) {
      router.push(fallbackOperationId ? `/operations/${fallbackOperationId}${teamQuery}` : `/operations${teamQuery}`);
    }

    router.refresh();
  }
}

// 서버 거절 사유 코드(code)별 사용자 안내. 화면에서 삭제 가능으로 보였는데 거절됐다면 화면·서버 판단이 어긋난 것이라
// 사용자가 고칠 수 없다. 관리자 자동 알림은 day1b2b/hub-om#708에서 이 코드를 기준으로 붙인다.
function deleteFailureMessage(code: unknown): string {
  if (code === "LAST_ROUND" || code === "FIRST_ROUND") {
    return "이 회차는 지금 삭제할 수 없는 상태로 확인됐습니다. 화면 표시와 다른 문제일 수 있으니 관리자에게 알려주세요.";
  }
  return "삭제하지 못했습니다.";
}
