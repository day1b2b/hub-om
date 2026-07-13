"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ResultReportStatus } from "@/lib/data/operationTypes";

interface ResultReportRequirementCellProps {
  hasResultReport: ResultReportStatus;
  operationId: string;
}

type SaveState = "idle" | "saving" | "failed";

export function ResultReportRequirementCell({ hasResultReport, operationId }: ResultReportRequirementCellProps) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const required = hasResultReport !== "불필요";

  return (
    <td className="round-resource-cell">
      <div className="round-resource-cell-view">
        <span className={`archive-pill ${required ? "done" : "muted"}`}>{required ? "Y" : "N"}</span>
        <button className="round-resource-edit-trigger" disabled={saveState === "saving"} onClick={toggleRequired} type="button">
          {saveState === "saving" ? "변경 중" : required ? "N으로 변경" : "Y로 변경"}
        </button>
      </div>
      {saveState === "failed" ? <span className="archive-item-save-error">변경하지 못했습니다.</span> : null}
    </td>
  );

  async function toggleRequired() {
    setSaveState("saving");

    const nextValue: ResultReportStatus = required ? "불필요" : "확인필요";

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ patches: [{ field: "hasResultReport", action: "replace", value: nextValue }] })
      });
    } catch {
      setSaveState("failed");
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean };

    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      return;
    }

    setSaveState("idle");
    router.refresh();
  }
}
