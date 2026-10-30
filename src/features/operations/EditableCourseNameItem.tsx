"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SaveState = "idle" | "saving" | "failed";

interface EditableCourseNameItemProps {
  displayValue: string;
  label: string;
  operationIds: string[];
  value: string;
}

export function EditableCourseNameItem({ displayValue, label, operationIds, value }: EditableCourseNameItemProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  if (!isEditing) {
    return (
      <div className="info-item editable-info-item">
        <span>{label}</span>
        <div className="info-item-value-row">
          <strong>{displayValue}</strong>
          <button className="info-item-edit-trigger" onClick={startEditing} type="button">
            수정
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="info-item editable-info-item editing">
      <span>{label}</span>
      <div className="info-item-edit-form">
        <input
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="예: AX 교육 실무2"
          type="text"
          value={draft}
        />
        <div className="info-item-edit-actions">
          <button disabled={saveState === "saving"} onClick={save} type="button">
            {saveState === "saving" ? "저장 중" : "저장"}
          </button>
          <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
            취소
          </button>
        </div>
      </div>
      {saveState === "failed" ? <span className="info-item-save-error">저장하지 못했습니다.</span> : null}
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
    const nextValue = draft.trim();

    if (!nextValue) {
      setSaveState("failed");
      return;
    }

    setSaveState("saving");

    const results = await Promise.all(
      operationIds.map((operationId) =>
        fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ patches: [{ field: "courseName", action: "replace", value: nextValue }] })
        })
          .then((response) => response.ok)
          .catch(() => false)
      )
    );

    if (!results.every(Boolean)) {
      setSaveState("failed");
      return;
    }

    setIsEditing(false);
    setSaveState("idle");
    router.refresh();
  }
}
