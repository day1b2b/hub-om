"use client";

import { useState, type ChangeEvent } from "react";
import type { InstructorNote, InstructorNotionProfile } from "@/lib/data/instructorWikiStore";

// 노션 페이지 ID·파트너 ID는 화면에서 다루지 않는다.
// 노션 ID는 연결 스크립트가 채우고 이동은 헤더의 노션 칩으로 한다. 저장은 부분 병합이라 값은 그대로 보존된다.
// 폼에서 편집하는 자유 입력 칸만 남긴다. 식별값(notionNo·instructorName)과
// 자동 채움값(notion)·별도 컨트롤(recruitAvoid·displayName 등)은 제외한다.
type Field = Exclude<
  keyof InstructorNote,
  "recruitAvoid" | "displayName" | "notionId" | "partnerId" | "notion" | "notionNo" | "instructorName"
>;
type FormState = Record<Field, string>;

// 연락처·이메일은 PII라 읽기 모드에서 가운데를 가린다. "✏ 수정"을 누르면 원본이 보인다.
function maskPhone(value: string): string {
  return value.replace(/(\d{2,3})[-. ]?(\d{3,4})[-. ]?(\d{4})/g, (_, head, mid, tail) => `${head}-${"*".repeat(mid.length)}-${tail}`);
}

function maskEmail(value: string): string {
  return value.replace(/([^\s@/]+)@([^\s@/]+)/g, (_, local: string, domain: string) => {
    const head = local.slice(0, Math.min(3, local.length));
    return `${head}${"*".repeat(Math.max(local.length - head.length, 1))}@${domain}`;
  });
}

const MASK: Partial<Record<Field, (value: string) => string>> = { contact: maskPhone, email: maskEmail };

// 강사위키 OM 입력 폼. 평소엔 읽기 전용, "수정" 버튼을 눌러야 편집 가능. 저장 시 /api/instructor-wiki/save로 전송.
export function InstructorEditor({
  name,
  initial,
  notion
}: {
  name: string;
  initial: InstructorNote;
  notion?: InstructorNotionProfile;
}) {
  // OM이 입력한 값이 없을 때만 노션 값을 대신 보여준다. 노션 값을 폼에 넣지는 않는다
  // (넣으면 저장 시 노션 값이 OM 입력값으로 굳어져서 다음 가져오기 때 갱신되지 않는다).
  const notionFallback: Partial<Record<Field, string>> = {
    contact: [notion?.contact, notion?.contact2].filter(Boolean).join(" / "),
    email: [notion?.email, notion?.email2].filter(Boolean).join(" / "),
    notes: notion?.memo ?? ""
  };

  const build = (): FormState => ({
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

  // 읽기 모드 표시값: OM 입력값이 우선, 없으면 노션 값. 연락처·이메일은 마스킹해서 보여준다.
  const shown = (key: Field) => {
    const raw = form[key] || notionFallback[key] || "";
    const mask = MASK[key];
    return raw && mask ? mask(raw) : raw;
  };

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
        ) : shown(key) ? (
          <span className="wiki-view">{shown(key)}</span>
        ) : (
          <span className="td-muted">—</span>
        )}
      </dd>
    </div>
  );

  return (
    <div className="detail-section">
      <div className="section-title"><h2>강사 정보</h2>{controls}</div>
      <div className="section-body">
        <dl className="field-preview-list">
          {field("연락처", "contact", { placeholder: "예: 010-0000-0000" })}
          {field("이메일", "email", { placeholder: "이메일" })}
          {field("강사 특이사항", "notes", { textarea: true, placeholder: "강사 특이사항 (강의 스타일·주의사항·선호 등)" })}
        </dl>
        <p className="field-hint">연락처·이메일은 개인정보(PII)예요. 로컬(dev) 파일에 저장되며, 배포 저장은 권한·보안 검토 후 DB 연동 시 반영됩니다.</p>
      </div>
    </div>
  );
}
