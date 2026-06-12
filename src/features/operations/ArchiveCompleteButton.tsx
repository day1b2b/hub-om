"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchiveStatus } from "@/lib/data/operationTypes";

interface ArchiveCompleteButtonProps {
  archiveStatus: ArchiveStatus;
  operationId: string;
}

type SaveState = "idle" | "saving" | "saved" | "failed";

export function ArchiveCompleteButton({ archiveStatus, operationId }: ArchiveCompleteButtonProps) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const isDone = archiveStatus === "완료";

  if (isDone || saveState === "saved") {
    return <span className="archive-complete-state">완료됨</span>;
  }

  return (
    <button
      aria-label="아카이브 상태를 완료로 표시"
      className={`archive-complete-button ${saveState === "failed" ? "failed" : ""}`}
      disabled={saveState === "saving"}
      onClick={markArchiveDone}
      type="button"
    >
      {buttonLabel(saveState)}
    </button>
  );

  async function markArchiveDone() {
    setSaveState("saving");

    const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        patches: [
          {
            field: "archiveStatus",
            action: "replace",
            value: "완료"
          }
        ]
      })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean };

    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      return;
    }

    setSaveState("saved");
    router.refresh();
  }
}

function buttonLabel(saveState: SaveState) {
  if (saveState === "saving") return "저장 중";
  if (saveState === "failed") return "재시도";
  return "완료로 표시";
}
