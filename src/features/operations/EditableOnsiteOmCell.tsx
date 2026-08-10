"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NameSelectEditor } from "./EditableInfoItem";
import type { OnsiteRequired } from "@/lib/data/operationTypes";
import { displayRoleAssigneeText } from "@/lib/data/roleAssignees";

type SaveState = "idle" | "saving" | "failed";

interface EditableOnsiteOmCellProps {
  om: string;
  onsiteOm: string;
  onsiteRequired: OnsiteRequired;
  operationId: string;
  options: string[];
}

export function EditableOnsiteOmCell({ om, onsiteOm, onsiteRequired, operationId, options }: EditableOnsiteOmCellProps) {
  const router = useRouter();
  const effectiveValue = onsiteOm || om;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(effectiveValue);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  if (onsiteRequired !== "Y") {
    return <td className="round-resource-cell" />;
  }

  if (!isEditing) {
    return (
      <td className="round-resource-cell">
        <div className="round-resource-cell-view">
          <span>{displayRoleAssigneeText(effectiveValue, "배정필요")}</span>
          <button className="round-resource-edit-trigger" onClick={startEditing} type="button">
            수정
          </button>
        </div>
      </td>
    );
  }

  return (
    <td className="round-resource-cell editing">
      <div className="round-resource-cell-edit-form">
        <NameSelectEditor fieldName="onsiteOm" label="현장운영" onChange={setDraft} options={options} value={draft} />
      </div>
      <div className="round-resource-cell-edit-actions">
        <button disabled={saveState === "saving"} onClick={save} type="button">
          {saveState === "saving" ? "저장 중" : "저장"}
        </button>
        <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
          취소
        </button>
      </div>
      {saveState === "failed" ? <span className="archive-item-save-error">저장하지 못했습니다.</span> : null}
    </td>
  );

  function startEditing() {
    setDraft(effectiveValue);
    setSaveState("idle");
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(effectiveValue);
    setSaveState("idle");
    setIsEditing(false);
  }

  async function save() {
    setSaveState("saving");

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ patches: [{ field: "onsiteOm", action: "replace", value: draft.trim() }] })
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
