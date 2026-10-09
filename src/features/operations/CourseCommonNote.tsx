"use client";

import type { CourseCommonNote as CourseCommonNoteValue } from "@/lib/data/operationTypes";
import { useEffect, useState } from "react";
import { commonNoteEntries } from "./courseCommonNoteModel";

export { commonNoteEntries } from "./courseCommonNoteModel";

type Field = "specialNotes" | "operationIssue" | "omUpdate";
const labels: Record<Field, string> = { specialNotes: "특이사항 / 이슈", operationIssue: "회고 (OM+LD)", omUpdate: "메모" };

export function CourseCommonNote({ note, operationId }: { note?: CourseCommonNoteValue; operationId: string }) {
  const [draft, setDraft] = useState<CourseCommonNoteValue>({ specialNotes: note?.specialNotes ?? "", operationIssue: note?.operationIssue ?? "", omUpdate: note?.omUpdate ?? "" });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ field: Field; value: string }>).detail;
      if (!detail || !(detail.field in labels)) return;
      setDraft(current => ({ ...current, [detail.field]: detail.value }));
      setState("idle");
    };
    window.addEventListener("course-common-note-suggestion", handler);
    return () => window.removeEventListener("course-common-note-suggestion", handler);
  }, []);

  async function save() {
    setState("saving");
    const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/common-note`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) }).catch(() => null);
    setState(response?.ok ? "saved" : "failed");
  }

  return <section aria-labelledby="course-common-note-title" className="detail-section">
    <div className="section-title"><h2 id="course-common-note-title">공통 메모</h2><span>과정 전체에 적용됩니다. 회차별 메모는 변경하지 않습니다.</span></div>
    <div className="course-common-note-editor">
      {(Object.keys(labels) as Field[]).map(field => <label key={field}>{labels[field]}<textarea value={draft[field]} onChange={event => { setDraft(current => ({ ...current, [field]: event.target.value })); setState("idle"); }} /></label>)}
      <button type="button" onClick={save} disabled={state === "saving"}>{state === "saving" ? "저장 중" : "공통 메모 저장"}</button>
      {state === "saved" ? <span role="status">저장했습니다.</span> : null}
      {state === "failed" ? <span role="alert">저장하지 못했습니다.</span> : null}
    </div>
    {!draft.specialNotes && !draft.operationIssue && !draft.omUpdate && commonNoteEntries(note ?? { specialNotes: "", operationIssue: "", omUpdate: "" }).length === 0 ? <p>등록된 공통 메모가 없습니다.</p> : null}
  </section>;
}
