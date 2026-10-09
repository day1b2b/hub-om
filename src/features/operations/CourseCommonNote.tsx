"use client";

import { useEffect, useMemo, useState } from "react";
import { useBrowserDraftSession } from "@/components/BrowserDraftProvider";
import type { CourseCommonNote as CourseCommonNoteValue } from "@/lib/data/operationTypes";
import { browserDrafts } from "@/lib/privacy/browserDraftRuntime";
import { runActiveDraftTask, useDraftActivity } from "./operationDraftSession";
import { confirmedSaveTime, memoSaveStatusText, type MemoSaveState } from "./memoSaveStatus";

export { commonNoteEntries } from "./courseCommonNoteModel";

type Field = "specialNotes" | "operationIssue" | "omUpdate";
type SaveState = MemoSaveState;
type CommonNoteDraft = { operationId: string; updatedAt: string; values: CourseCommonNoteValue };

const EMPTY: CourseCommonNoteValue = { specialNotes: "", operationIssue: "", omUpdate: "" };
const fields: Array<{ field: Field; label: string; placeholder: string }> = [
  { field: "specialNotes", label: "특이사항 / 이슈", placeholder: "과정 전체에 공통으로 적용할 특이사항이나 이슈" },
  { field: "operationIssue", label: "회고 (OM+LD)", placeholder: "과정 전체에 공통으로 적용할 회고" },
  { field: "omUpdate", label: "메모", placeholder: "과정 전체에 공통으로 적용할 메모" }
];

export function CourseCommonNote({ note, onDirtyChange, operationId }: { note?: CourseCommonNoteValue; onDirtyChange?: (dirty: boolean) => void; operationId: string }) {
  const session = useBrowserDraftSession();
  if (session.status !== "ready") return <LockedCommonNote note={note} />;
  return <ReadyCourseCommonNote key={`${session.ownerId}:${session.generation}:${operationId}`} note={note} onDirtyChange={onDirtyChange} operationId={operationId} />;
}

function ReadyCourseCommonNote({ note, onDirtyChange, operationId }: { note?: CourseCommonNoteValue; onDirtyChange?: (dirty: boolean) => void; operationId: string }) {
  const active = useDraftActivity();
  const initial = useMemo(() => note ?? EMPTY, [note]);
  const [baseValues, setBaseValues] = useState<CourseCommonNoteValue>(initial);
  const [values, setValues] = useState<CourseCommonNoteValue>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [detail, setDetail] = useState("");
  const hasChanges = fields.some(({ field }) => values[field] !== baseValues[field]);

  useEffect(() => { onDirtyChange?.(hasChanges); }, [hasChanges, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    void browserDrafts.read<unknown>("course-common-note", operationId).then(raw => {
      if (cancelled || !active()) return;
      if (raw !== null) {
        const draft = validateDraft(raw, operationId);
        setValues(draft.values);
        setDraftSavedAt(draft.updatedAt);
      }
      setDraftReady(true);
    }, () => {
      if (!cancelled && active()) setDetail("개인 초안을 읽지 못했습니다. 초안 연결 상태를 확인해 주세요.");
    });
    return () => { cancelled = true; };
  }, [active, operationId]);

  useEffect(() => {
    if (!draftReady || saveState === "saving") return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      const updatedAt = new Date().toISOString();
      const task = runActiveDraftTask(() => !cancelled && active(), () => hasChanges
        ? browserDrafts.write("course-common-note", operationId, { operationId, updatedAt, values })
        : browserDrafts.remove("course-common-note", operationId));
      if (!task) return;
      void task.then(() => {
        if (!cancelled && active()) setDraftSavedAt(hasChanges ? updatedAt : null);
      }, () => {
        if (!cancelled && active()) {
          setDraftSavedAt(null);
          setDetail("개인 초안을 보관하지 못했습니다. 입력은 유지되지만 창을 닫으면 잃을 수 있습니다.");
        }
      });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [active, draftReady, hasChanges, operationId, saveState, values]);

  useEffect(() => {
    if (!hasChanges) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasChanges]);

  async function save() {
    if (!draftReady || !active() || !hasChanges || saveState === "saving") return;
    const submitted = values;
    setSaveState("saving");
    setDetail("");
    const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/common-note`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submitted)
    }).catch(() => null);
    if (!active()) return;
    if (!response?.ok) {
      setSaveState("failed");
      setDetail(!response ? "저장하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요." : response.status === 401 ? "로그인이 만료되었습니다. 다시 로그인한 뒤 재시도해 주세요." : response.status === 403 ? "과정 공통 메모를 저장할 권한이 없습니다." : "저장하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    setBaseValues(submitted);
    setSaveState("saved");
    setSavedAt(new Date());
    try { await browserDrafts.remove("course-common-note", operationId); }
    catch { if (active()) setDetail("서버 저장은 완료했지만 개인 초안을 정리하지 못했습니다."); }
    if (!active()) return;
    setDraftSavedAt(null);
  }

  return <div className="issue-editor course-common-note-editor">
    <p className="course-notes-editor-hint">전체 회차에 공통으로 적용되는 내용입니다. 회차별 메모는 변경하지 않습니다.</p>
    {!draftReady ? <p role="status">개인 초안을 확인하는 중입니다.</p> : null}
    <fieldset disabled={!draftReady || saveState === "saving"} style={{ border: 0, margin: 0, padding: 0 }}>
      <div className="issue-editor-grid">
        {fields.map(item => <div className="issue-editor-field" key={item.field}>
          <div className="issue-editor-field-head"><label htmlFor={`course-common-note-${item.field}`}>{item.label}</label></div>
          <textarea id={`course-common-note-${item.field}`} placeholder={item.placeholder} rows={4} value={values[item.field]} onChange={event => {
            setValues(current => ({ ...current, [item.field]: event.target.value }));
            setSaveState("idle");
            setSavedAt(null);
            setDetail("");
          }} />
        </div>)}
      </div>
      <div className="issue-editor-footer">
        <div className="issue-review-summary">
          <span aria-live="polite" className={`issue-save-message ${saveState}`}>{memoSaveStatusText(saveState, hasChanges, savedAt ? confirmedSaveTime(savedAt) : null)}</span>
          {draftSavedAt ? <small>{formatDraftTime(draftSavedAt)} 개인 초안 보관 · 서버에 저장되지 않음</small> : null}
        </div>
        <div className="issue-editor-actions"><button disabled={!hasChanges || saveState === "saving"} type="button" onClick={save}>{saveState === "saving" ? "저장 중…" : saveState === "failed" ? "다시 시도" : "과정 공통 메모 저장"}</button></div>
      </div>
    </fieldset>
    {detail ? <p className={`issue-save-detail ${saveState}`} role={saveState === "failed" ? "alert" : "status"}>{detail}</p> : null}
  </div>;
}

function LockedCommonNote({ note = EMPTY }: { note?: CourseCommonNoteValue }) {
  return <div className="issue-editor course-common-note-editor">
    <p role="status">개인 초안 보관함이 잠겨 있어 수정할 수 없습니다. 로그인과 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
    <fieldset disabled style={{ border: 0, margin: 0, padding: 0 }}><div className="issue-editor-grid">{fields.map(item => <div className="issue-editor-field" key={item.field}><div className="issue-editor-field-head"><label htmlFor={`locked-common-note-${item.field}`}>{item.label}</label></div><textarea id={`locked-common-note-${item.field}`} rows={4} value={note[item.field]} readOnly /></div>)}</div></fieldset>
  </div>;
}

function validateDraft(value: unknown, operationId: string): CommonNoteDraft {
  if (!value || typeof value !== "object") throw new Error("Invalid common note draft");
  const draft = value as Partial<CommonNoteDraft>;
  if (draft.operationId !== operationId || typeof draft.updatedAt !== "string" || !draft.values || fields.some(({ field }) => typeof draft.values?.[field] !== "string")) throw new Error("Invalid common note draft");
  return draft as CommonNoteDraft;
}

function formatDraftTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
