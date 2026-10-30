"use client";

import { useState } from "react";
import { COMPANY_MEMO_MAX_LENGTH } from "@/lib/data/companyBusinessInfoTypes";

// 기업위키 상세의 메모 카드. 사업자등록증 정보와 같은 API로 memo만 저장한다.
export function CompanyMemoEditor({ companyId, initial }: { companyId: string; initial: string | null }) {
  const [memo, setMemo] = useState(initial ?? "");
  const [draft, setDraft] = useState(memo);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function startEdit() {
    setDraft(memo);
    setStatus("idle");
    setEditing(true);
  }

  function cancel() {
    setDraft(memo);
    setEditing(false);
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch("/api/company-wiki/business-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, memo: draft })
      });
      if (res.ok) {
        setMemo(draft.trim());
        setEditing(false);
        setStatus("saved");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  const statusText =
    status === "saving" ? "저장 중…" : status === "saved" ? "저장됨 ✓" : status === "error" ? "저장 실패" : "";

  const controls = editing ? (
    <span className="editor-controls">
      {status === "error" ? <span className="editor-status is-error">저장 실패</span> : null}
      <button className="editor-save" type="button" onClick={save} disabled={status === "saving"}>저장</button>
      <button className="editor-cancel" type="button" onClick={cancel} disabled={status === "saving"}>취소</button>
    </span>
  ) : (
    <span className="editor-controls">
      {statusText ? <span className={`editor-status${status === "error" ? " is-error" : ""}`}>{statusText}</span> : null}
      <button className="editor-edit" type="button" onClick={startEdit}>✏ 수정</button>
    </span>
  );

  return (
    <div className="detail-section">
      <div className="section-title"><h2>메모</h2>{controls}</div>
      <div className="section-body">
        {editing ? (
          <textarea
            aria-label="메모"
            className="wiki-input wiki-memo-input"
            maxLength={COMPANY_MEMO_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="기업 관련 참고사항을 자유롭게 남겨 주세요. 예: 계산서는 역발행, 담당자 변경 이력"
            rows={6}
            value={draft}
          />
        ) : memo ? (
          <p className="wiki-memo-view">{memo}</p>
        ) : (
          <p className="field-hint">아직 메모가 없습니다. 수정을 눌러 남겨 주세요.</p>
        )}
      </div>
    </div>
  );
}
