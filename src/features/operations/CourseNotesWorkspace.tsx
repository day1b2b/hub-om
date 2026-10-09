"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export function CourseNotesWorkspace({ common, rounds, className = "" }: { common: ReactNode; rounds: Array<{ label: string; content: ReactNode; operationId: string }>; className?: string }) {
  const [selected, setSelected] = useState<"common" | number>("common");
  const isCommon = selected === "common";
  const round = typeof selected === "number" ? rounds[selected] : undefined;

  return <section id="operation-notes" className={`course-notes-workspace detail-section ${className}`}>
    <div className="section-title"><h2>메모</h2></div>
    <div className="course-notes-tabs" role="tablist" aria-label="메모 범위 선택">
      <button className={isCommon ? "active" : ""} onClick={() => setSelected("common")} role="tab" aria-selected={isCommon} type="button">과정 공통</button>
      {rounds.map((item, index) => <button key={item.operationId} className={selected === index ? "active" : ""} onClick={() => setSelected(index)} role="tab" aria-selected={selected === index} type="button">{item.label}</button>)}
    </div>
    <div className="course-notes-tab-panel">{isCommon ? common : round?.content}</div>
  </section>;
}
