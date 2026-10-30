"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { companyNameError } from "@/lib/data/companyName";

// 운영 상세 제목 앞의 기업명. 처음부터 정확히 입력하는 게 원칙이라 카드에 수정 칸을 두지 않고,
// 제목의 기업명을 눌러야만 고칠 수 있게 했다. 저장하면 이 과정의 모든 회차·기업위키·연결된
// 업무 요청 기업명이 같이 바뀐다(서버의 changeCourseCompany).
export function EditableTitleCompany({ companyName, operationId }: { companyName: string; operationId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(companyName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button
        className="title-company title-company--editable"
        onClick={() => {
          setDraft(companyName);
          setError(null);
          setEditing(true);
        }}
        title="눌러서 기업명 수정"
        type="button"
      >
        {companyName}
      </button>
    );
  }

  const unchanged = draft.trim() === companyName.trim();
  const inputError = unchanged ? null : companyNameError(draft);

  async function save() {
    if (unchanged) {
      setEditing(false);
      return;
    }
    if (inputError) {
      setError(inputError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patches: [{ field: "companyName", action: "replace", value: draft.trim() }] })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "저장하지 못했습니다.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="title-company-editor">
      <input
        aria-label="기업명"
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
          if (event.key === "Escape") setEditing(false);
        }}
        placeholder="띄어쓰기 없이 정확한 기업명"
        value={draft}
      />
      <button disabled={saving || Boolean(inputError)} onClick={() => void save()} type="button">{saving ? "저장 중" : "저장"}</button>
      <button disabled={saving} onClick={() => setEditing(false)} type="button">취소</button>
      <span className={error || inputError ? "title-company-hint is-error" : "title-company-hint"}>
        {error ?? inputError ?? "이 과정의 모든 회차·기업위키·업무 요청 기업명이 같이 바뀝니다."}
      </span>
    </span>
  );
}
