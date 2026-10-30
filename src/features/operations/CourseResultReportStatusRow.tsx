"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ResultReportStatus } from "@/lib/data/operationTypes";

interface CourseResultReportStatusRowProps {
  courseRecordId: string;
  hasResultReport?: ResultReportStatus;
}

type SaveState = "idle" | "saving" | "failed";

/**
 * 결과보고서 여부를 과정(Course) 레벨로 1개만 관리한다. 회차별 ResultReportRequirementCell과
 * 판정 로직은 같지만(불필요 ↔ 확인필요 토글) courseRecordId를 받아
 * `/api/courses/[courseRecordId]/result-report-status`에 저장한다. 과정 레벨 값이 아직
 * 승격되지 않았으면(hasResultReport undefined, 백필 전) "확인필요"로 간주해 표시한다.
 */
export function CourseResultReportStatusRow({ courseRecordId, hasResultReport }: CourseResultReportStatusRowProps) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const effective = hasResultReport ?? "확인필요";
  const required = effective !== "불필요";

  return (
    <div className={`archive-item-row ${required ? "done" : "missing"}`}>
      <strong>결과보고서 여부</strong>
      <div className="archive-item-actions">
        <span className={`archive-pill ${required ? "done" : "muted"}`}>{required ? "Y" : "N"}</span>
        <button className="archive-item-edit-trigger" disabled={saveState === "saving"} onClick={toggleRequired} type="button">
          {saveState === "saving" ? "변경 중" : required ? "N으로 변경" : "Y로 변경"}
        </button>
      </div>
      {saveState === "failed" ? <span className="archive-item-save-error">변경하지 못했습니다.</span> : null}
    </div>
  );

  async function toggleRequired() {
    setSaveState("saving");

    const nextValue: ResultReportStatus = required ? "불필요" : "확인필요";

    let response: Response;

    try {
      response = await fetch(`/api/courses/${encodeURIComponent(courseRecordId)}/result-report-status`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hasResultReport: nextValue })
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
