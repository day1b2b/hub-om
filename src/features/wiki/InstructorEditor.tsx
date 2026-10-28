"use client";

import { useState, type ChangeEvent } from "react";
import type { InstructorNote, InstructorNotionProfile } from "@/lib/data/instructorWikiStore";
import { PeopleCard } from "@/features/people/PeopleProfile";

// 강사 위키 "운영 메모". OM이 쌓는 강사 특이사항(notes)만 편집한다.
// 저장 시 /api/instructor-wiki/save로 보낸다. 연락처·이메일은 오른쪽 연락처 칸에서 따로 열람한다.
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

  // 읽기값: OM 입력값이 우선, 없으면 노션 메모. 편집은 OM 입력값만 다룬다.
  const notesShown = notes || notion?.memo || "";

  return (
    <PeopleCard actions={controls} note="OM 전용" title="운영 메모">
      {editing ? (
        <textarea
          className="wiki-textarea wiki-textarea--lg"
          value={notes}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)}
          rows={6}
          placeholder="강점 · 유의사항 · 소통 스타일 · 강의 스타일 · 비고"
          aria-label="운영 메모"
        />
      ) : notesShown ? (
        <p className="wiki-view people-memo">{notesShown}</p>
      ) : (
        <p className="td-muted">아직 남긴 메모가 없어요. 강점·유의사항·소통/강의 스타일을 적어 두면 다음 섭외 때 바로 볼 수 있어요.</p>
      )}
      {!notes && notion?.memo ? <p className="field-hint">노션 강사 DB의 메모를 보여 주고 있어요. 수정하면 허브에 저장됩니다.</p> : null}
    </PeopleCard>
  );
}
