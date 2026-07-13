"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ResultReportStatus } from "@/lib/data/operationTypes";

interface ResultReportRequirementCellProps {
  hasResultReport: ResultReportStatus;
  operationId: string;
}

export function ResultReportRequirementCell({ hasResultReport, operationId }: ResultReportRequirementCellProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const required = hasResultReport !== "불필요";

  return (
    <td className="round-resource-cell">
      <div className="round-resource-cell-view">
        <span className={`archive-pill ${required ? "done" : "muted"}`}>{required ? "대상" : "대상 아님"}</span>
        <button className="round-resource-edit-trigger" disabled={isSaving} onClick={toggleRequired} type="button">
          {required ? "대상 아님으로 변경" : "대상으로 변경"}
        </button>
      </div>
    </td>
  );

  async function toggleRequired() {
    setIsSaving(true);

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
      setIsSaving(false);
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean };

    if (!response.ok || !payload.ok) {
      setIsSaving(false);
      return;
    }

    router.refresh();
  }
}
