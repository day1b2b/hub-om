"use client";

import { useState } from "react";
import type { OperationSession } from "@/lib/data/operationTypes";

const fields = [["specialNotes", "특이사항 / 이슈"], ["operationIssue", "회고 (OM+LD)"], ["omUpdate", "메모"]] as const;

export function CourseNotesCandidates({ operations }: { operations: OperationSession[] }) {
  const [copied, setCopied] = useState(false);
  const operation = operations[0];
  if (!operation) return null;
  return <div className="course-notes-round-preview">
    <div className="course-notes-round-fields">
      {fields.map(([field, label]) => <div className="course-notes-round-field" key={field}><strong>{label}</strong><pre>{operation[field].trim() || "기록 없음"}</pre></div>)}
    </div>
    <div className="course-notes-actions">
      <button className="course-notes-copy-button" type="button" onClick={async () => {
        const text = fields.map(([field, label]) => `${label}\n${operation[field].trim()}`).join("\n\n");
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}>{copied ? "복사됨" : "복사하기"}</button>
      <button className="course-notes-apply-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent("course-common-note-apply", { detail: { specialNotes: operation.specialNotes, operationIssue: operation.operationIssue, omUpdate: operation.omUpdate } }))}>적용하기</button>
    </div>
  </div>;
}
