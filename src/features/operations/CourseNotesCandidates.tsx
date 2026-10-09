"use client";

import type { OperationSession } from "@/lib/data/operationTypes";
import { useState } from "react";

const fields = [["specialNotes", "특이사항 / 이슈"], ["operationIssue", "회고 (OM+LD)"], ["omUpdate", "메모"]] as const;
type Field = (typeof fields)[number][0];

export function CourseNotesCandidates({ operations }: { operations: OperationSession[] }) {
  const rows = [...operations].sort((a, b) => Number(a.roundNo) - Number(b.roundNo));
  const [selected, setSelected] = useState(rows[0]?.operationId ?? "");
  const operation = rows.find(row => row.operationId === selected) ?? rows[0];
  if (!operation) return null;
  return <section aria-labelledby="course-notes-candidates-title" className="detail-section course-notes-candidates">
    <div className="section-title"><h2 id="course-notes-candidates-title">회차별 메모</h2><span>회차를 선택해 해당 회차의 메모를 확인합니다.</span></div>
    <div className="course-round-tabs" role="tablist" aria-label="회차 선택">
      {rows.map(row => <button key={row.operationId} className={row.operationId === operation.operationId ? "active" : ""} onClick={() => setSelected(row.operationId)} role="tab" aria-selected={row.operationId === operation.operationId} type="button">{row.roundNo || "미정"}회차</button>)}
    </div>
    <div className="course-notes-round-fields">
      {fields.map(([field, label]) => {
        const value = operation[field].trim();
        return <div className="course-notes-round-field" key={field}><strong>{label}</strong>{value ? <><pre>{value}</pre><button type="button" onClick={() => suggest(field, value)}>이 내용으로 공통 메모 변경</button></> : <span className="course-notes-empty">기록 없음</span>}</div>;
      })}
    </div>
  </section>;
}

function suggest(field: Field, value: string) {
  window.dispatchEvent(new CustomEvent("course-common-note-suggestion", { detail: { field, value } }));
}
