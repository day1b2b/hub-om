"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface ImportPromoteButtonProps {
  importRunId: string;
}

interface PromotionPayload {
  ok?: boolean;
  error?: string;
  result?: {
    blocked: number;
    created: number;
    eligible: number;
    linkedExisting: number;
    sourceRows: number;
  };
}

export function ImportPromoteButton({ importRunId }: ImportPromoteButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const isBusy = isSubmitting || isPending;

  async function promoteRows() {
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/imports/${encodeURIComponent(importRunId)}/promote`, {
        method: "POST"
      });
      const payload = (await response.json()) as PromotionPayload;

      if (!response.ok || !payload.ok || !payload.result) {
        setMessage(payload.error ?? "반영하지 못했습니다.");
        return;
      }

      const { blocked, created, linkedExisting } = payload.result;
      setMessage(`생성 ${created}건 · 기존 연결 ${linkedExisting}건 · 남김 ${blocked}건`);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setMessage("반영 요청을 처리하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="import-promote-action">
      <button disabled={isBusy} type="button" onClick={promoteRows}>
        {isBusy ? "반영 중" : "맞는 행 한번에 반영"}
      </button>
      {message ? <span>{message}</span> : null}
    </div>
  );
}
