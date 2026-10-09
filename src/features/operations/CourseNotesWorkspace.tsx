"use client";

import { useState } from "react";
import type { CourseCommonNote as CourseCommonNoteValue, OperationSession } from "@/lib/data/operationTypes";
import { CourseCommonNote } from "./CourseCommonNote";
import { IssueReviewEditor } from "./IssueReviewEditor";

type Target = "common" | string;

export function CourseNotesWorkspace({
  className = "",
  commonNote,
  operationId,
  rounds
}: {
  className?: string;
  commonNote?: CourseCommonNoteValue;
  operationId: string;
  rounds: OperationSession[];
}) {
  const [selected, setSelected] = useState<Target>("common");
  const [dirty, setDirty] = useState<Record<Target, boolean>>({ common: false });

  return <section id="operation-notes" className={`course-notes-workspace detail-section ${className}`}>
    <div className="section-title"><h2>메모</h2></div>
    <div className="course-notes-tabs" role="tablist" aria-label="메모 범위 선택">
      <NoteTab dirty={dirty.common} label="과정 공통" selected={selected === "common"} onSelect={() => setSelected("common")} />
      <div className="course-notes-round-tabs">
        {rounds.map((round, index) => {
          const label = `${round.roundNo || index + 1}회차`;
          return <NoteTab dirty={Boolean(dirty[round.operationId])} key={round.operationId} label={label} selected={selected === round.operationId} onSelect={() => setSelected(round.operationId)} />;
        })}
      </div>
    </div>
    <div className="course-notes-tab-panels">
      <div hidden={selected !== "common"} role="tabpanel">
        <CourseCommonNote note={commonNote} operationId={operationId} onDirtyChange={(value) => setDirty(current => current.common === value ? current : { ...current, common: value })} />
      </div>
      {rounds.map((round, index) => {
        const label = `${round.roundNo || index + 1}회차`;
        return <div hidden={selected !== round.operationId} key={round.operationId} role="tabpanel">
          <IssueReviewEditor operation={round} targetLabel={`${label} 메모`} onDirtyChange={(value) => setDirty(current => current[round.operationId] === value ? current : { ...current, [round.operationId]: value })} />
        </div>;
      })}
    </div>
  </section>;
}

function NoteTab({ dirty, label, onSelect, selected }: { dirty: boolean; label: string; onSelect: () => void; selected: boolean }) {
  return <button className={selected ? "active" : ""} onClick={onSelect} role="tab" aria-label={`${label}${dirty ? ", 저장하지 않은 변경 사항 있음" : ""}`} aria-selected={selected} type="button">
    {label}{dirty ? <span aria-hidden="true" className="course-notes-unsaved-dot">●</span> : null}
  </button>;
}
