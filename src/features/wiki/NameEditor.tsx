"use client";

import { useState } from "react";

// 헤더(맨 위 이름 박스)에서 강사명을 수정한다. "이름 수정" → 편집 → 저장.
// 저장값(displayName)은 로컬 파일에 기록. 배포 영구저장은 DB 연동 시.
export function NameEditor({ name, initialName }: { name: string; initialName: string }) {
  const [value, setValue] = useState(initialName);
  const [saved, setSaved] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch("/api/instructor-wiki/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, displayName: value })
      });
      if (res.ok) {
        setSaved(value);
        setEditing(false);
        setStatus("idle");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  function cancel() {
    setValue(saved);
    setEditing(false);
    setStatus("idle");
  }

  if (editing) {
    return (
      <>
        <input className="wiki-input name-editor-input" value={value} onChange={(event) => setValue(event.target.value)} aria-label="강사명 수정" />
        <button className="editor-save" type="button" onClick={save} disabled={status === "saving"}>저장</button>
        <button className="editor-cancel" type="button" onClick={cancel} disabled={status === "saving"}>취소</button>
        {status === "error" ? <span className="editor-status is-error">저장 실패</span> : null}
      </>
    );
  }

  return (
    <>
      <h1>{saved}</h1>
      <button className="editor-edit name-edit-toggle" type="button" onClick={() => setEditing(true)}>✏ 이름 수정</button>
    </>
  );
}
