"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type Placement = "bottom" | "right";

export function CourseNotesWorkspace({ common, rounds, className = "" }: { common: ReactNode; rounds: Array<{ label: string; content: ReactNode; operationId: string }>; className?: string }) {
  const [selected, setSelected] = useState<"common" | number>("common");
  const [placement, setPlacement] = useState<Placement>("bottom");
  const [canDockRight, setCanDockRight] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("hub-om:operation-notes-placement");
    if (stored === "bottom" || stored === "right") setPlacement(stored);
    const query = window.matchMedia("(min-width: 1700px)");
    const update = () => setCanDockRight(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const effectivePlacement = placement === "right" && canDockRight ? "right" : "bottom";
  const isCommon = selected === "common";
  const round = typeof selected === "number" ? rounds[selected] : undefined;

  function changePlacement(next: Placement) {
    setPlacement(next);
    window.localStorage.setItem("hub-om:operation-notes-placement", next);
  }

  return <section className={`course-notes-workspace detail-section ${className} notes-placement-${effectivePlacement}`}>
    <div className="section-title">
      <h2>메모</h2>
      <div className="course-notes-placement-actions">
        {effectivePlacement === "bottom" ? <button type="button" onClick={() => changePlacement("right")} disabled={!canDockRight} title={!canDockRight ? "브라우저 너비가 충분할 때 사용할 수 있습니다." : undefined}>오른쪽에 고정</button> : <button type="button" onClick={() => changePlacement("bottom")}>본문 아래로 이동</button>}
      </div>
    </div>
    <div className="course-notes-tabs" role="tablist" aria-label="메모 범위 선택">
      <button className={isCommon ? "active" : ""} onClick={() => setSelected("common")} role="tab" aria-selected={isCommon} type="button">과정 공통</button>
      {rounds.map((item, index) => <button key={item.operationId} className={selected === index ? "active" : ""} onClick={() => setSelected(index)} role="tab" aria-selected={selected === index} type="button">{item.label}</button>)}
    </div>
    <div className="course-notes-tab-panel">{isCommon ? common : round?.content}</div>
    {!canDockRight && placement === "right" ? <p className="course-notes-placement-hint" role="status">현재 화면 너비에서는 메모를 본문 아래에 표시합니다.</p> : null}
  </section>;
}
