"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { browserDrafts } from "@/lib/privacy/browserDraftRuntime";
import { useBrowserDraftSession } from "@/components/BrowserDraftProvider";
import { hasLegacyDraft, LEGACY_DRAFT_NOTICE, LOCKED_DRAFT_NOTICE, runActiveDraftTask, useDraftActivity } from "./operationDraftSession";
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
  const session = useBrowserDraftSession();
  if (session.status !== "ready") return <p role="status">{LOCKED_DRAFT_NOTICE}</p>;
  return <ReadyIssueReviewEditor key={`${session.ownerId}:${session.generation}:${operation.operationId}`} operation={operation} />;
}

function ReadyIssueReviewEditor({ operation }: IssueReviewEditorProps) {
  const active = useDraftActivity();
  const [submissionSubject] = useState(() => browserDrafts.getSubject());
  const [initialOperation] = useState(operation);
  const [baseValues, setBaseValues] = useState(() => operationValues(operation));
  const [legacy, setLegacy] = useState(false);
  const router = useRouter();
  const [values, setValues] = useState<IssueReviewValues>(() => operationValues(operation));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const hasChanges = useMemo(
    () =>
      values.specialNotes !== baseValues.specialNotes ||
      values.operationIssue !== baseValues.operationIssue ||
      values.omUpdate !== baseValues.omUpdate,
    [baseValues, values]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!active()) return;
      try {
        setLegacy(hasLegacyDraft(draftStorageKey(initialOperation.operationId)));
        const raw = await browserDrafts.read<unknown>("issue-review", initialOperation.operationId);
        if (cancelled || !active()) return;
        if (raw !== null) {
          const draft = validateDraft(raw, initialOperation.operationId);
          setValues(draft.values);
          setDraftSavedAt(draft.updatedAt);
          setMessage("저장하지 않은 개인 초안을 불러왔습니다");
        }
        setDraftReady(true);
      } catch {
        if (!cancelled && active()) setMessage("개인 초안을 읽지 못했습니다. 입력을 시작하기 전에 다시 연결해 주세요.");
      }
    })();
    return () => { cancelled = true; };
  }, [active, initialOperation]);

  useEffect(() => {
    if (!draftReady || saveState === "saving") return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      const updatedAt = new Date().toISOString();
      const task = runActiveDraftTask(() => !cancelled && active(), () => hasChanges
        ? browserDrafts.write("issue-review", operation.operationId, { operationId: operation.operationId, updatedAt, values })
        : browserDrafts.remove("issue-review", operation.operationId));
      if (!task) return;
      void task.then(() => {
        if (!cancelled && active()) setDraftSavedAt(hasChanges ? updatedAt : null);
      }, () => {
        if (!cancelled && active()) {
          setDraftSavedAt(null);
          setMessage("개인 초안을 보관하지 못했습니다. 입력은 유지되며 창을 닫으면 잃을 수 있습니다.");
        }
      });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [active, draftReady, hasChanges, operation.operationId, saveState, values]);

  useEffect(() => {
    if (!hasChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasChanges]);

  return (
    <div className="issue-editor">
      {legacy ? <p role="status">{LEGACY_DRAFT_NOTICE}</p> : null}
      {!draftReady ? <p role="status">개인 초안을 확인하는 중입니다.</p> : null}
      <fieldset disabled={!draftReady || saveState === "saving"} style={{ border: 0, padding: 0, margin: 0 }}><div className="issue-editor-grid">
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
                setDraftSavedAt(null);
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
          {draftSavedAt ? (
            <small>{formatDraftTime(draftSavedAt)} 임시 저장됨 · 나만 보임, 아직 반영 안 됨</small>
          ) : null}
        </div>
        <div className="issue-editor-actions">
          {message ? <span className={`issue-save-message ${saveState}`}>{message}</span> : null}
          <button disabled={!hasChanges || saveState === "saving"} onClick={resetDraft} type="button">
            작성 취소
          </button>
          <button disabled={!hasChanges || saveState === "saving"} onClick={saveNotes} type="button">
            {saveState === "saving" ? "저장 중" : "저장하기"}
          </button>
        </div>
      </div></fieldset>
    </div>
  );

  async function resetDraft() {
    if (!active() || !draftReady) return;
    const confirmed = window.confirm(
      "작성 중인 내용이 사라집니다. 마지막으로 저장한 내용으로 되돌릴까요?"
    );

    if (!confirmed) return;
    setSaveState("saving");

    try { await browserDrafts.remove("issue-review", operation.operationId); }
    catch { if (active()) { setSaveState("idle"); setMessage("개인 초안을 지우지 못해 입력을 유지합니다."); } return; }
    if (!active()) return;
    setValues(baseValues);
    setDraftSavedAt(null);
    setSaveState("idle");
    setMessage("마지막 저장 내용으로 되돌림");
  }

  async function saveNotes() {
    if (!active() || !draftReady || !submissionSubject) return;
    setSaveState("saving");
    setMessage("");

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operation.operationId)}/drive-import/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Operation-Submission-Subject": submissionSubject
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
      if (!active()) return;
      setSaveState("failed");
      setMessage("저장 요청 실패 · 잠시 후 다시 시도해 주세요");
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!active()) return;
    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      setMessage(payload.error ?? "저장하지 못했습니다.");
      return;
    }

    setBaseValues(values);
    try { await browserDrafts.remove("issue-review", operation.operationId); }
    catch {
      if (active()) { setSaveState("saved"); setMessage("서버 저장 완료 · 개인 초안 정리는 실패했습니다."); router.refresh(); }
      return;
    }
    if (!active()) return;
    setDraftSavedAt(null);
    setSaveState("saved");
    setMessage("저장 완료 · 모두에게 반영됨");
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

function validateDraft(value: unknown, operationId: string): { updatedAt: string; values: IssueReviewValues } {
  if (!value || typeof value !== "object") throw new Error("Invalid issue draft");
  const draft = value as Partial<IssueReviewDraft>;
  if (draft.operationId !== operationId || typeof draft.updatedAt !== "string" || !draft.values || EDIT_FIELDS.some(({ field }) => typeof draft.values?.[field] !== "string")) throw new Error("Invalid issue draft");
  return { updatedAt: draft.updatedAt, values: draft.values as IssueReviewValues };
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
