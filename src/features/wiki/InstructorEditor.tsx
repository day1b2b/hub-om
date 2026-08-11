"use client";

import { useState, type ChangeEvent } from "react";
import type { InstructorNote } from "@/lib/data/instructorWikiStore";

type Field = Exclude<keyof InstructorNote, "recruitAvoid" | "displayName">;
type FormState = Record<Field, string>;

// 강사위키 OM 입력 폼. 평소엔 읽기 전용, "수정" 버튼을 눌러야 편집 가능. 저장 시 /api/instructor-wiki/save로 전송.
export function InstructorEditor({ name, initial }: { name: string; initial: InstructorNote }) {
  const build = (): FormState => ({
    notionId: initial.notionId ?? "",
    partnerId: initial.partnerId ?? "",
    notes: initial.notes ?? "",
    contact: initial.contact ?? "",
    email: initial.email ?? ""
  });

  const [form, setForm] = useState<FormState>(build);
  const [snapshot, setSnapshot] = useState<FormState>(form);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const set = (key: Field) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  function startEdit() {
    setSnapshot(form);
    setStatus("idle");
    setEditing(true);
  }

  function cancel() {
    setForm(snapshot);
    setEditing(false);
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch("/api/instructor-wiki/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...form })
      });
      if (res.ok) {
        setSnapshot(form);
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

  const field = (label: string, key: Field, opts: { textarea?: boolean; placeholder?: string } = {}) => (
    <div key={key}>
      <dt>{label}</dt>
      <dd>
        {editing ? (
          opts.textarea ? (
            <textarea className="wiki-textarea wiki-textarea--lg" value={form[key]} onChange={set(key)} rows={5} placeholder={opts.placeholder} aria-label={label} />
          ) : (
            <input className="wiki-input" value={form[key]} onChange={set(key)} placeholder={opts.placeholder} aria-label={label} />
          )
        ) : (
          <span className={form[key] ? "wiki-view" : "td-muted"}>{form[key] || "—"}</span>
        )}
      </dd>
    </div>
  );

  return (
    <div className="detail-section">
      <div className="section-title"><h2>강사 정보</h2>{controls}</div>
      <div className="section-body">
        <dl className="field-preview-list">
          {field("파트너 ID", "partnerId", { placeholder: "예: PT-00123" })}
          {field("노션 페이지 ID", "notionId", { placeholder: "노션 강사 페이지 고유 ID 또는 URL" })}
          {field("연락처", "contact", { placeholder: "예: 010-0000-0000" })}
          {field("이메일", "email", { placeholder: "이메일" })}
          {field("강사 특이사항", "notes", { textarea: true, placeholder: "강사 특이사항 (강의 스타일·주의사항·선호 등)" })}
        </dl>
        <p className="field-hint">연락처·이메일은 개인정보(PII)예요. 로컬(dev) 파일에 저장되며, 배포 저장은 권한·보안 검토 후 DB 연동 시 반영됩니다.</p>
      </div>
    </div>
  );
}
