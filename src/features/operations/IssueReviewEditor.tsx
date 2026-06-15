"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { OperationSession } from "@/lib/data/operationTypes";

interface IssueReviewEditorProps {
  operation: OperationSession;
}

type SaveState = "idle" | "saving" | "saved" | "failed";

const EDIT_FIELDS = [
  {
    field: "specialNotes",
    label: "특이사항",
    placeholder: "현장 운영자가 알아야 할 특이사항을 기록"
  },
  {
    field: "operationIssue",
    label: "운영 이슈",
    placeholder: "지연, 누락, 이슈, 후속 조치가 필요한 내용을 기록"
  },
  {
    field: "omUpdate",
    label: "OM 업데이트",
    placeholder: "OM 관점의 변경 사항이나 다음 운영자에게 남길 메모"
  }
] as const;

export function IssueReviewEditor({ operation }: IssueReviewEditorProps) {
  const router = useRouter();
  const [values, setValues] = useState({
    specialNotes: operation.specialNotes,
    operationIssue: operation.operationIssue,
    omUpdate: operation.omUpdate
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const hasChanges = useMemo(
    () =>
      values.specialNotes !== operation.specialNotes ||
      values.operationIssue !== operation.operationIssue ||
      values.omUpdate !== operation.omUpdate,
    [operation.omUpdate, operation.operationIssue, operation.specialNotes, values]
  );

  return (
    <div className="issue-editor">
      <div className="issue-editor-grid">
        {EDIT_FIELDS.map((editField) => (
          <div className="issue-editor-field" key={editField.field}>
            <label htmlFor={`issue-editor-${editField.field}`}>{editField.label}</label>
            <textarea
              id={`issue-editor-${editField.field}`}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  [editField.field]: event.target.value
                }));
                setSaveState("idle");
                setMessage("");
              }}
              placeholder={editField.placeholder}
              rows={4}
              value={values[editField.field]}
            />
          </div>
        ))}
      </div>

      <div className="issue-editor-footer">
        <div className="issue-review-summary">
          <span>검토 필요</span>
          <strong>{operation.validationErrors.length > 0 ? operation.validationErrors.join(", ") : "없음"}</strong>
        </div>
        <div className="issue-editor-actions">
          {message ? <span className={`issue-save-message ${saveState}`}>{message}</span> : null}
          <button disabled={!hasChanges || saveState === "saving"} onClick={saveNotes} type="button">
            {saveState === "saving" ? "저장 중" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );

  async function saveNotes() {
    setSaveState("saving");
    setMessage("");

    const response = await fetch(`/api/operations/${encodeURIComponent(operation.operationId)}/drive-import/apply`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        patches: EDIT_FIELDS.map((editField) => ({
          field: editField.field,
          action: "replace",
          value: values[editField.field]
        }))
      })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      setMessage(payload.error ?? "저장하지 못했습니다.");
      return;
    }

    setSaveState("saved");
    setMessage("저장됨");
    router.refresh();
  }
}
