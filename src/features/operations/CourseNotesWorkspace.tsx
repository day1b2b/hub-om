"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export function CourseNotesWorkspace({ common, rounds, roundCount }: { common: ReactNode; rounds: ReactNode; roundCount: number }) {
  const [tab, setTab] = useState<"common" | "rounds">("common");
  return <section className="course-notes-workspace">
    <div className="course-notes-tabs" role="tablist" aria-label="메모 보기">
      <button className={tab === "common" ? "active" : ""} onClick={() => setTab("common")} role="tab" aria-selected={tab === "common"} type="button">공통 메모</button>
      <button className={tab === "rounds" ? "active" : ""} onClick={() => setTab("rounds")} role="tab" aria-selected={tab === "rounds"} type="button">회차별 메모 <span>{roundCount}</span></button>
    </div>
    <div className="course-notes-tab-panel">{tab === "common" ? common : rounds}</div>
  </section>;
}
