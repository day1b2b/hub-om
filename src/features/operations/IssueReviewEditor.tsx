"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { OperationSession } from "@/lib/data/operationTypes";

interface IssueReviewEditorProps {
  operation: OperationSession;
}

type SaveState = "idle" | "saving" | "saved" | "failed";

const EDIT_FIELDS = [
  {
    field: "specialNotes",
    label: "특이사항 / 이슈",
    placeholder: "이 과정의 특이사항, 이슈, 후속 조치 등"
  },
  {
    field: "operationIssue",
    label: "회고 (OM+LD)",
    placeholder: "과정에 대한 회고 (강사, 고객사와 회고 나눈 내용도 포함)"
  },
  {
    field: "omUpdate",
    label: "메모",
    placeholder: "업무 중 자유롭게 활용"
  }
] as const;

type IssueReviewValues = Record<(typeof EDIT_FIELDS)[number]["field"], string>;
type IssueReviewDraft = {
  operationId: string;
  updatedAt: string;
  values: Partial<IssueReviewValues>;
};

export function IssueReviewEditor({ operation }: IssueReviewEditorProps) {
  const router = useRouter();
  const [values, setValues] = useState<IssueReviewValues>(() => operationValues(operation));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const hasChanges = useMemo(
    () =>
      values.specialNotes !== operation.specialNotes ||
      values.operationIssue !== operation.operationIssue ||
      values.omUpdate !== operation.omUpdate,
    [operation.omUpdate, operation.operationIssue, operation.specialNotes, values]
  );
  const hasDraft = draftSavedAt !== null;
  const hasReadableChanges = hasChanges || hasDraft;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const draft = readDraft(operation.operationId);
      const baseValues = operationValues(operation);

      if (draft) {
        setValues(draft.values);
        setDraftSavedAt(draft.updatedAt);
        setMessage("임시저장 불러옴");
      } else {
        setValues(baseValues);
        setDraftSavedAt(null);
        setMessage("");
      }

      setSaveState("idle");
      setDraftReady(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [operation]);

  useEffect(() => {
    if (!draftReady || saveState === "saving") return;

    const draftKey = draftStorageKey(operation.operationId);

    if (!hasChanges) {
      window.localStorage.removeItem(draftKey);
      const timeout = window.setTimeout(() => setDraftSavedAt(null), 0);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => {
      const updatedAt = new Date().toISOString();

      window.localStorage.setItem(
        draftKey,
        JSON.stringify({
          operationId: operation.operationId,
          updatedAt,
          values
        })
      );
      setDraftSavedAt(updatedAt);
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [draftReady, hasChanges, operation.operationId, saveState, values]);

  return (
    <div className="issue-editor">
      <div className="issue-editor-grid">
        {EDIT_FIELDS.map((editField) => (
          <div className="issue-editor-field" key={editField.field}>
            <div className="issue-editor-field-head">
              <label htmlFor={`issue-editor-${editField.field}`}>{editField.label}</label>
            </div>
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
              rows={7}
              value={values[editField.field]}
            />
          </div>
        ))}
      </div>

      <div className="issue-editor-footer">
        <div className="issue-review-summary">
          <span>{hasReadableChanges ? "작성 상태" : "검토 필요"}</span>
          <strong>{operation.validationErrors.length > 0 ? operation.validationErrors.join(", ") : "없음"}</strong>
          {draftSavedAt ? <small>임시저장 {formatDraftTime(draftSavedAt)}</small> : null}
        </div>
        <div className="issue-editor-actions">
          {message ? <span className={`issue-save-message ${saveState}`}>{message}</span> : null}
          <button disabled={!hasChanges || saveState === "saving"} onClick={resetDraft} type="button">
            되돌리기
          </button>
          <button disabled={!hasChanges || saveState === "saving"} onClick={saveNotes} type="button">
            {saveState === "saving" ? "DB 저장 중" : "DB 저장"}
          </button>
        </div>
      </div>
    </div>
  );

  function resetDraft() {
    window.localStorage.removeItem(draftStorageKey(operation.operationId));
    setValues(operationValues(operation));
    setDraftSavedAt(null);
    setSaveState("idle");
    setMessage("서버 저장값으로 되돌림");
  }

  async function saveNotes() {
    setSaveState("saving");
    setMessage("");

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operation.operationId)}/drive-import/apply`, {
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
    } catch {
      setSaveState("failed");
      setMessage("DB 저장 요청 실패");
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      setMessage(payload.error ?? "저장하지 못했습니다.");
      return;
    }

    window.localStorage.removeItem(draftStorageKey(operation.operationId));
    setDraftSavedAt(null);
    setSaveState("saved");
    setMessage("DB 저장됨");
    router.refresh();
  }
}

function operationValues(operation: OperationSession): IssueReviewValues {
  return {
    specialNotes: normalizeStoredNote(operation.specialNotes),
    operationIssue: normalizeStoredNote(operation.operationIssue),
    omUpdate: normalizeStoredNote(operation.omUpdate)
  };
}

function draftStorageKey(operationId: string) {
  return `hub-om:issue-review-draft:${operationId}`;
}

function readDraft(operationId: string): { updatedAt: string; values: IssueReviewValues } | null {
  const draftText = window.localStorage.getItem(draftStorageKey(operationId));

  if (!draftText) return null;

  let draft: Partial<IssueReviewDraft>;

  try {
    draft = JSON.parse(draftText) as Partial<IssueReviewDraft>;
  } catch {
    window.localStorage.removeItem(draftStorageKey(operationId));
    return null;
  }

  if (draft.operationId !== operationId || !draft.updatedAt || !draft.values) return null;

  return {
    updatedAt: draft.updatedAt,
    values: {
      specialNotes: typeof draft.values.specialNotes === "string" ? draft.values.specialNotes : "",
      operationIssue: typeof draft.values.operationIssue === "string" ? draft.values.operationIssue : "",
      omUpdate: typeof draft.values.omUpdate === "string" ? draft.values.omUpdate : ""
    }
  };
}

function normalizeStoredNote(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\s+[-•]\s+/g, "\n- ")
    .replace(/\s+(특이사항|이슈|조치|회고|후속|원인|결과|다음 액션|OM 업데이트)\s*:/g, "\n$1: ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatDraftTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
