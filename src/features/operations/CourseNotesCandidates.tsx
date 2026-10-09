"use client";

import type { OperationSession } from "@/lib/data/operationTypes";

import { getCourseNoteCandidates } from "./courseNotesCandidateModel";

export function CourseNotesCandidates({ operations }: { operations: OperationSession[] }) {
  const rows = getCourseNoteCandidates(operations);

  if (rows.every((row) => row.values.length === 0)) return null;

  return (
    <section aria-labelledby="course-notes-candidates-title" className="detail-section course-notes-candidates">
      <div className="section-title">
        <h2 id="course-notes-candidates-title">공통 메모 후보</h2>
        <span>기존 회차 데이터를 읽어 후보만 제안합니다. 아직 저장 위치는 바뀌지 않습니다.</span>
      </div>
      <div className="course-notes-candidate-list">
        {rows.filter((row) => row.values.length > 0).map((row) => (
          <article className="course-notes-candidate" key={row.field}>
            <div className="course-notes-candidate-head">
              <strong>{row.label}</strong>
              <span>{row.commonCandidate ? "공통 후보" : "회차별 확인 필요"}</span>
            </div>
            <ul>
              {row.values.map((item) => (
                <li key={`${row.field}-${item.roundNo}`}>
                  <b>{item.roundNo}회차</b>
                  <pre>{item.value}</pre>
                  <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("course-common-note-suggestion", { detail: { field: row.field, value: item.value } }))}>이 내용으로 공통 메모 변경</button>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
