"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export function CourseNotesWorkspace({ common, rounds }: { common: ReactNode; rounds: Array<{ label: string; content: ReactNode }> }) {
  const [selected, setSelected] = useState(0);
  const tabs = [{ label: "공통 메모", content: common }, ...rounds];
  return <section className="course-notes-workspace">
    <div className="course-notes-tabs" role="tablist" aria-label="메모 보기">
      {tabs.map((tab, index) => <button key={tab.label} className={index === selected ? "active" : ""} onClick={() => setSelected(index)} role="tab" aria-selected={index === selected} type="button">{tab.label}{index > 0 ? <span>{index}</span> : null}</button>)}
    </div>
    <div className="course-notes-tab-panel">{tabs[selected].content}</div>
  </section>;
}
