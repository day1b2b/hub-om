"use client";

import type { CourseCommonNote as CourseCommonNoteValue } from "@/lib/data/operationTypes";
import { useEffect, useState } from "react";
import { commonNoteEntries } from "./courseCommonNoteModel";

export { commonNoteEntries } from "./courseCommonNoteModel";

type Field = "specialNotes" | "operationIssue" | "omUpdate";
const labels: Record<Field, { label: string; placeholder: string }> = {
  specialNotes: { label: "특이사항 / 이슈", placeholder: "과정 전체에 공통으로 적용할 특이사항이나 이슈" },
  operationIssue: { label: "회고 (OM+LD)", placeholder: "과정 전체에 공통으로 적용할 회고" },
  omUpdate: { label: "메모", placeholder: "과정 전체에 공통으로 적용할 메모" }
};

type SaveState = "idle" | "saving" | "saved" | "failed";

export function CourseCommonNote({ note, operationId }: { note?: CourseCommonNoteValue; operationId: string }) {
  const [draft, setDraft] = useState<CourseCommonNoteValue>({ specialNotes: note?.specialNotes ?? "", operationIssue: note?.operationIssue ?? "", omUpdate: note?.omUpdate ?? "" });
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ field: Field; value: string }>).detail;
      if (!detail || !(detail.field in labels)) return;
      setDraft(current => ({ ...current, [detail.field]: detail.value }));
      setState("idle");
      setMessage("");
    };
    window.addEventListener("course-common-note-suggestion", handler);
    return () => window.removeEventListener("course-common-note-suggestion", handler);
  }, []);

  async function save() {
    setState("saving");
    setMessage("");
    const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/common-note`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) }).catch(() => null);
    if (response?.ok) {
      setState("saved");
      setMessage("저장 완료 · 과정 전체에 반영됨");
    } else {
      setState("failed");
      setMessage("저장하지 못했습니다. 다시 시도해 주세요.");
    }
  }

  return <div className="issue-editor course-common-note-editor">
    <p className="course-notes-editor-hint">전체 회차에 공통으로 적용되는 내용입니다. 회차별 메모는 변경하지 않습니다.</p>
    <div className="issue-editor-grid">
      {(Object.keys(labels) as Field[]).map(field => <div className="issue-editor-field" key={field}>
        <div className="issue-editor-field-head"><label htmlFor={`course-common-note-${field}`}>{labels[field].label}</label></div>
        <textarea id={`course-common-note-${field}`} placeholder={labels[field].placeholder} rows={4} value={draft[field]} onChange={event => { setDraft(current => ({ ...current, [field]: event.target.value })); setState("idle"); setMessage(""); }} />
      </div>)}
    </div>
    <div className="issue-editor-footer">
      <div className="issue-review-summary">{message ? <span className={`issue-save-message ${state}`} role={state === "failed" ? "alert" : "status"}>{message}</span> : null}</div>
      <div className="issue-editor-actions"><button type="button" onClick={save} disabled={state === "saving"}>{state === "saving" ? "저장 중" : state === "failed" ? "다시 저장" : "저장하기"}</button></div>
    </div>
    {!draft.specialNotes && !draft.operationIssue && !draft.omUpdate && commonNoteEntries(note ?? { specialNotes: "", operationIssue: "", omUpdate: "" }).length === 0 ? <p className="course-notes-empty">등록된 공통 메모가 없습니다.</p> : null}
  </div>;
}
