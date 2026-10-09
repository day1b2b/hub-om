"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export function CourseNotesWorkspace({ className, rounds }: { className?: string; rounds: Array<{ label: string; content: ReactNode; operationId: string }> }) {
  const [selected, setSelected] = useState(0);
  const tab = rounds[selected];
  return <section className={`course-notes-workspace detail-section ${className ?? ""}`}>
    <div className="section-title"><h2>회차별 메모</h2><span>회차별 기존 메모를 확인하고 필요한 경우 적용합니다.</span></div>
    <div className="course-notes-tabs" role="tablist" aria-label="회차 선택">
      {rounds.map((round, index) => <button key={round.operationId} className={index === selected ? "active" : ""} onClick={() => setSelected(index)} role="tab" aria-selected={index === selected} type="button">{round.label}</button>)}
    </div>
    <div className="course-notes-tab-panel">{tab?.content}</div>
  </section>;
}
