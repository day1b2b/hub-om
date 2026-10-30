"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SaveState = "idle" | "saving" | "failed";

interface EditableCourseNameItemProps {
  displayValue: string;
  /** 과정명(기본) 또는 기업명. 둘 다 과정의 모든 회차에 같은 값으로 저장한다. */
  field?: "companyName" | "courseName";
  label: string;
  operationIds: string[];
  placeholder?: string;
  value: string;
}

export function EditableCourseNameItem({
  displayValue,
  field = "courseName",
  label,
  operationIds,
  placeholder = "예: AX 교육 실무2",
  value
}: EditableCourseNameItemProps) {
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
          placeholder={placeholder}
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

    const saveRound = (operationId: string) =>
      fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ patches: [{ field, action: "replace", value: nextValue }] })
      })
        .then((response) => response.ok)
        .catch(() => false);

    // 기업명은 과정(Course) 하나를 옮기는 작업이라 회차를 동시에 보내면 서로 경합한다 — 차례로 보낸다.
    // 첫 회차에서 과정이 옮겨지고, 나머지 회차는 캘린더 제목만 따라 바뀐다.
    const results: boolean[] = [];
    if (field === "companyName") {
      for (const operationId of operationIds) results.push(await saveRound(operationId));
    } else {
      results.push(...(await Promise.all(operationIds.map(saveRound))));
    }

    if (!results.every(Boolean)) {
      setSaveState("failed");
      return;
    }

    setIsEditing(false);
    setSaveState("idle");
    router.refresh();
  }
}
