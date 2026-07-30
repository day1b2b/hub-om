"use client";

import { useState } from "react";

// 섭외 지양 토글. 켜면 강사 이름 옆에 "섭외 지양" 표시하고 즉시 저장한다.
export function RecruitAvoidToggle({ name, initialAvoid }: { name: string; initialAvoid: boolean }) {
  const [avoid, setAvoid] = useState(initialAvoid);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !avoid;
    setAvoid(next);
    setSaving(true);
    try {
      await fetch("/api/instructor-wiki/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, recruitAvoid: next })
      });
    } catch {
      // 저장 실패해도 화면 토글 상태는 유지(다음 저장 때 반영)
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="recruit-avoid">
      {avoid ? <span className="recruit-avoid-badge">⛔ 섭외 지양</span> : null}
      <button
        className={avoid ? "recruit-avoid-btn is-on" : "recruit-avoid-btn"}
        onClick={toggle}
        type="button"
        disabled={saving}
      >
        {avoid ? "섭외 지양 해제" : "섭외 지양"}
      </button>
    </span>
  );
}
