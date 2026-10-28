"use client";

import { useState, type ChangeEvent } from "react";
import type { InstructorNote, InstructorNotionProfile } from "@/lib/data/instructorWikiStore";
import { MaskedField } from "@/features/coaches/MaskedField";

// 강사위키 "강사 정보". 연락처·이메일은 개인정보라 기본 마스킹 → 클릭하면 복호화 열람(코치와 동일, 열람 감사).
// 강사 특이사항(notes)만 OM이 편집한다. 저장 시 /api/instructor-wiki/save로 보내며, 연락처·이메일은 보내지 않는다.
// 노션에 연결된 강사(instructor_notes 행 있음 = id 있음)만 열람 버튼을 보여준다.
export function InstructorEditor({
  name,
  initial,
  notion
}: {
  name: string;
  initial: InstructorNote;
  notion?: InstructorNotionProfile;
}) {
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [snapshot, setSnapshot] = useState(notes);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function startEdit() {
    setSnapshot(notes);
    setStatus("idle");
    setEditing(true);
  }

  function cancel() {
    setNotes(snapshot);
    setEditing(false);
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch("/api/instructor-wiki/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, notes })
      });
      if (res.ok) {
        setSnapshot(notes);
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

  // 특이사항 읽기값: OM 입력값이 우선, 없으면 노션 메모. 편집은 OM 입력값만 다룬다.
  const notesShown = notes || notion?.memo || "";

  return (
    <div className="detail-section">
      <div className="section-title"><h2>강사 정보</h2>{controls}</div>
      <div className="section-body">
        <dl className="field-preview-list">
          <div>
            <dt>연락처</dt>
            <dd>
              {initial.id ? (
                <MaskedField entity="instructor" id={initial.id} field="contact" label="연락처" />
              ) : (
                <span className="td-muted">노션에 연결되면 열람할 수 있어요</span>
              )}
            </dd>
          </div>
          <div>
            <dt>이메일</dt>
            <dd>
              {initial.id ? (
                <MaskedField entity="instructor" id={initial.id} field="email" label="이메일" />
              ) : (
                <span className="td-muted">노션에 연결되면 열람할 수 있어요</span>
              )}
            </dd>
          </div>
          <div>
            <dt>강사 특이사항</dt>
            <dd>
              {editing ? (
                <textarea
                  className="wiki-textarea wiki-textarea--lg"
                  value={notes}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)}
                  rows={5}
                  placeholder="강사 특이사항 (강의 스타일·주의사항·선호 등)"
                  aria-label="강사 특이사항"
                />
              ) : notesShown ? (
                <span className="wiki-view">{notesShown}</span>
              ) : (
                <span className="td-muted">—</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="field-hint">
          연락처·이메일은 암호화 저장되고, 클릭하면 열람할 수 있어요(열람 기록이 남습니다). 노션 강사 DB의 값이라 원본은 노션에서 수정해 주세요.
        </p>
      </div>
    </div>
  );
}
