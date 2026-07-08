"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";

export function AssignForm({ request }: { request: OmRequest }) {
  const router = useRouter();
  const [om, setOm] = useState(request.assignedOm ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDone = request.status === "배정완료";

  async function handleSave() {
    if (!om.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/om-request/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, assignedOm: om.trim() })
      });
      if (!res.ok) throw new Error("저장 실패");
      router.refresh();
    } catch {
      setError("저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!confirm("배정을 취소하시겠습니까?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/om-request/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, assignedOm: null })
      });
      if (!res.ok) throw new Error("취소 실패");
      setOm("");
      router.refresh();
    } catch {
      setError("취소에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="assign-form">
      <input
        type="text"
        placeholder="OM 이름 입력"
        value={om}
        onChange={(e) => setOm(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSave()}
        className="assign-form-input"
      />
      <div className="assign-form-row">
        <button
          className="assign-save-btn"
          disabled={saving || !om.trim()}
          onClick={handleSave}
        >
          저장
        </button>
        {isDone && (
          <button className="assign-cancel-btn" disabled={saving} onClick={handleCancel}>
            삭제
          </button>
        )}
      </div>
      {error && <p className="om-request-error">{error}</p>}
    </div>
  );
}
