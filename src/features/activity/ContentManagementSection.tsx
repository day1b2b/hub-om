"use client";
import { useState } from "react";
import { ContentManagementPanel } from "@/features/coaches/ContentManagementPanel";
export function ContentManagementSection({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return <section id="content" className="dashboard-panel" style={{ marginTop: 32 }} aria-label="메모·리뷰 관리">
    <h2>메모·리뷰 관리</h2>
    <p>등록된 코치 메모와 리뷰를 관리합니다. 수정·삭제 작업은 전체 변경 이력에 기록됩니다.</p>
    <button type="button" className="secondary-action" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "관리 목록 접기" : "메모·리뷰 관리 열기"}</button>
    {open ? <ContentManagementPanel onChanged={onChanged} /> : null}
  </section>;
}
