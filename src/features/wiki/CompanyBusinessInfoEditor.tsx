"use client";

import { useState, type ChangeEvent } from "react";
import type { CompanyBusinessInfo, CompanyBusinessInfoPatch } from "@/lib/data/companyBusinessInfoTypes";

// 메모는 별도 카드(CompanyMemoEditor)에서 따로 저장한다 — 이 폼은 보내지 않아 건드리지 않는다.
type Field = Exclude<keyof CompanyBusinessInfoPatch, "memo">;
type FormState = Record<Field, string>;

// 기업위키 사업자등록증 정보 입력 폼. 평소엔 읽기 전용, "수정" 버튼을 눌러야 편집 가능.
// 저장 시 /api/company-wiki/business-info로 전송한다(companyId 기준 부분 병합).
export function CompanyBusinessInfoEditor({
  companyId,
  initial
}: {
  companyId: string;
  initial: CompanyBusinessInfo;
}) {
  const build = (): FormState => ({
    businessNumber: initial.businessNumber ?? "",
    representativeName: initial.representativeName ?? "",
    address: initial.address ?? "",
    businessType: initial.businessType ?? "",
    businessItem: initial.businessItem ?? "",
    invoiceEmail: initial.invoiceEmail ?? "",
    invoiceEmailSecondary: initial.invoiceEmailSecondary ?? ""
  });

  const [form, setForm] = useState<FormState>(build);
  const [snapshot, setSnapshot] = useState<FormState>(form);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const set = (key: Field) => (event: ChangeEvent<HTMLInputElement>) =>
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
      const res = await fetch("/api/company-wiki/business-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...form })
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

  const field = (label: string, key: Field, placeholder?: string) => (
    <div key={key}>
      <dt>{label}</dt>
      <dd>
        {editing ? (
          <input className="wiki-input" value={form[key]} onChange={set(key)} placeholder={placeholder} aria-label={label} />
        ) : form[key] ? (
          <span className="wiki-view">{form[key]}</span>
        ) : (
          <span className="td-muted">—</span>
        )}
      </dd>
    </div>
  );

  return (
    <div className="detail-section">
      <div className="section-title"><h2>사업자등록증 정보</h2>{controls}</div>
      <div className="section-body">
        <dl className="field-preview-list">
          {field("사업자등록번호", "businessNumber", "- 없이 10자리")}
          {field("대표자", "representativeName")}
          {field("주소", "address")}
          {field("업태", "businessType")}
          {field("종목", "businessItem")}
          {field("계산서 수신 이메일(1)", "invoiceEmail")}
          {field("계산서 수신 이메일(2)", "invoiceEmailSecondary")}
        </dl>
        <p className="field-hint">
          계산서 발행 요청 시 이 정보로 구글폼을 미리 채워 줍니다. 값이 바뀌면 여기서 수정해 주세요.
        </p>
      </div>
    </div>
  );
}
