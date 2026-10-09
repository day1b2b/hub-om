"use client";

import type { OperationSession } from "@/lib/data/operationTypes";

const fields = [
  ["specialNotes", "특이사항 / 이슈"],
  ["operationIssue", "회고 (OM+LD)"],
  ["omUpdate", "메모"]
] as const;

type Field = (typeof fields)[number][0];

export function CourseNotesCandidates({ operations }: { operations: OperationSession[] }) {
  const rows = [...operations].sort((a, b) => Number(a.roundNo) - Number(b.roundNo));
  return <section aria-labelledby="course-notes-candidates-title" className="detail-section course-notes-candidates">
    <div className="section-title"><h2 id="course-notes-candidates-title">회차별 메모</h2><span>회차별 내용을 확인하고 필요한 경우 공통 메모로 가져올 수 있습니다.</span></div>
    <div className="course-notes-round-list">
      {rows.map(operation => <article className="course-notes-round-card" key={operation.operationId}>
        <h3>{operation.roundNo || "미정"}회차</h3>
        <div className="course-notes-round-fields">
          {fields.map(([field, label]) => {
            const value = operation[field].trim();
            return <div className="course-notes-round-field" key={field}>
              <strong>{label}</strong>
              {value ? <><pre>{value}</pre><button type="button" onClick={() => suggest(field, value)}>이 내용으로 공통 메모 변경</button></> : <span className="course-notes-empty">기록 없음</span>}
            </div>;
          })}
        </div>
      </article>)}
    </div>
  </section>;
}

function suggest(field: Field, value: string) {
  window.dispatchEvent(new CustomEvent("course-common-note-suggestion", { detail: { field, value } }));
}
