"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SaveState = "idle" | "saving" | "failed";

interface EditableSessionRegionCellProps {
  operationId: string;
  region: string;
}

export function EditableSessionRegionCell({ operationId, region }: EditableSessionRegionCellProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(region);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  if (!isEditing) {
    return (
      <td className="round-resource-cell session-cell-wrap">
        <button className="session-cell-select" onClick={startEditing} type="button">
          {region || "미정"}
        </button>
      </td>
    );
  }

  return (
    <td className="round-resource-cell editing">
      <div className="round-resource-cell-edit-form">
        <input
          aria-label="장소"
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          placeholder="예: 서울 강남"
          type="text"
          value={draft}
        />
      </div>
      <div className="round-resource-cell-edit-actions">
        <button disabled={saveState === "saving"} onClick={save} type="button">
          {saveState === "saving" ? "저장 중" : "저장"}
        </button>
        <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
          취소
        </button>
      </div>
      {saveState === "failed" ? <span className="lecture-note-save-error">저장하지 못했습니다.</span> : null}
    </td>
  );

  function startEditing() {
    setDraft(region);
    setSaveState("idle");
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(region);
    setSaveState("idle");
    setIsEditing(false);
  }

  async function save() {
    if (!confirm("장소를 수정하시겠습니까?")) return;

    setSaveState("saving");

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patches: [{ field: "region", action: "replace", value: draft.trim() }] })
      });
    } catch {
      setSaveState("failed");
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean };

    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      return;
    }

    setIsEditing(false);
    setSaveState("idle");
    router.refresh();
  }
}
