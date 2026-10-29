"use client";

import { useState } from "react";
import type { InstructorNote, InstructorNotionProfile } from "@/lib/data/instructorWikiStore";
import { PeopleCard } from "@/features/people/PeopleProfile";
import { MEMO_SECTIONS, parseInstructorMemo, serializeInstructorMemo, type InstructorMemo, type MemoSection } from "./instructorMemo";

const PLACEHOLDER: Record<MemoSection, string> = {
  강점: "예) 비전공자 눈높이 설명이 좋음",
  유의사항: "예) 장비 사전 점검 요청 많음. 리허설 30분 확보",
  "소통 스타일": "예) 메일보다 전화 선호, 답이 빠름",
  "강의 스타일": "예) 실습 위주, 질문을 많이 받음",
  비고: "그 밖에 다음 섭외 때 알아 둘 것"
};

// 강사 위키 "운영 메모". OM이 쌓는 강사 특이사항을 5칸(강점·유의사항·소통 스타일·강의 스타일·비고)으로 나눠 쓴다.
// 저장은 /api/instructor-wiki/save의 notes 한 칸에 머리말을 붙여 보낸다(instructorMemo.ts).
export function InstructorEditor({
  name,
  initial,
  notion
}: {
  name: string;
  initial: InstructorNote;
  notion?: InstructorNotionProfile;
}) {
  const [memo, setMemo] = useState<InstructorMemo>(() => parseInstructorMemo(initial.notes ?? ""));
  const [snapshot, setSnapshot] = useState(memo);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function startEdit() {
    setSnapshot(memo);
    setStatus("idle");
    setEditing(true);
  }

  function cancel() {
    setMemo(snapshot);
    setEditing(false);
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch("/api/instructor-wiki/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, notes: serializeInstructorMemo(memo) })
      });
      if (res.ok) {
        setSnapshot(memo);
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
      <button className="editor-save" type="button" onClick={save} disabled={status === "saving"}>저장</button>
      <button className="editor-cancel" type="button" onClick={cancel} disabled={status === "saving"}>취소</button>
    </span>
  ) : (
    <span className="editor-controls">
      {statusText ? <span className={`editor-status${status === "error" ? " is-error" : ""}`}>{statusText}</span> : null}
      <button className="editor-edit" type="button" onClick={startEdit}>✏ 수정</button>
    </span>
  );

  // OM이 쓴 메모가 하나도 없으면 노션 메모를 비고 자리에 보여 준다. 편집은 OM 입력값만 다룬다.
  const hasOmMemo = MEMO_SECTIONS.some((section) => memo[section]);
  const shown: InstructorMemo = !hasOmMemo && notion?.memo ? { ...memo, 비고: notion.memo } : memo;

  return (
    <PeopleCard actions={controls} note="OM 전용" title="운영 메모">
      {editing ? (
        <div className="people-memo-form">
          {MEMO_SECTIONS.map((section) => (
            <label className="people-memo-field" key={section}>
              <span>{section}</span>
              <textarea
                aria-label={section}
                className="wiki-textarea"
                onChange={(event) => setMemo((prev) => ({ ...prev, [section]: event.target.value }))}
                placeholder={PLACEHOLDER[section]}
                rows={section === "유의사항" || section === "비고" ? 3 : 2}
                value={memo[section]}
              />
            </label>
          ))}
        </div>
      ) : (
        <dl className="people-memo-view">
          {MEMO_SECTIONS.map((section) => (
            <div key={section}>
              <dt>{section}</dt>
              <dd>{shown[section] ? <span className="wiki-view">{shown[section]}</span> : <span className="td-muted">비어 있음</span>}</dd>
            </div>
          ))}
        </dl>
      )}
      {!editing && !hasOmMemo && notion?.memo ? (
        <p className="field-hint">노션 강사 DB의 메모를 비고에 보여 주고 있어요. 수정하면 허브에 저장됩니다.</p>
      ) : null}
    </PeopleCard>
  );
}
