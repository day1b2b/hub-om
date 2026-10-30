"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isNavigableHref, toHref } from "@/lib/links";

type SaveState = "idle" | "saving" | "failed";

interface EditableCourseReportLinkRowProps {
  courseRecordId: string;
  value: string;
}

/**
 * 결과보고서 링크를 과정(Course) 레벨로 1개만 등록한다. 회차별 EditableRoundResourceCell과
 * 달리 courseRecordId를 받아 `/api/courses/[courseRecordId]/report-link`에 저장한다.
 */
export function EditableCourseReportLinkRow({ courseRecordId, value }: EditableCourseReportLinkRowProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const done = Boolean(value.trim());
  const hasHref = isNavigableHref(value);

  if (!isEditing) {
    return (
      <div className={`archive-item-row ${done ? "done" : "missing"}`}>
        <strong>결과보고서</strong>
        <div className="archive-item-actions">
          {hasHref ? (
            <a className="archive-item-state" href={toHref(value) ?? value} rel="noreferrer" target="_blank">
              열기
            </a>
          ) : (
            <span className="archive-item-state">{done ? "등록됨" : "링크 없음"}</span>
          )}
          <button className="archive-item-edit-trigger" onClick={startEditing} type="button">
            {done ? "수정" : "등록"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="archive-item-row editing">
      <strong>결과보고서</strong>
      <div className="archive-item-edit-form">
        <input
          onChange={(event) => setDraft(event.target.value)}
          placeholder="https://"
          type="text"
          value={draft}
        />
        <button disabled={saveState === "saving"} onClick={save} type="button">
          {saveState === "saving" ? "저장 중" : "저장"}
        </button>
        <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
          취소
        </button>
      </div>
      {saveState === "failed" ? <span className="archive-item-save-error">저장하지 못했습니다.</span> : null}
    </div>
  );

  function startEditing() {
    setDraft(value);
    setSaveState("idle");
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(value);
    setSaveState("idle");
    setIsEditing(false);
  }

  async function save() {
    setSaveState("saving");
    const trimmed = draft.trim();

    let response: Response;
    try {
      response = await fetch(`/api/courses/${encodeURIComponent(courseRecordId)}/report-link`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resultReportLink: trimmed })
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

    setIsEditing(false);
    setSaveState("idle");
    router.refresh();
  }
}
