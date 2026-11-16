"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NameSelectEditor } from "./EditableInfoItem";
import type { OnsiteRequired } from "@/lib/data/operationTypes";
import { displayRoleAssigneeText } from "@/lib/data/roleAssignees";

type SaveState = "idle" | "saving" | "failed";

interface EditableOnsiteOmCellProps {
  /** 현장에 외부인력이 가는 드문 경우를 위해, "외부인력" 버튼을 눌렀을 때만 보여주는 실습코치 명단. */
  coachOptions: string[];
  om: string;
  onsiteOm: string;
  onsiteRequired: OnsiteRequired;
  operationId: string;
  options: string[];
}

export function EditableOnsiteOmCell({ coachOptions, om, onsiteOm, onsiteRequired, operationId, options }: EditableOnsiteOmCellProps) {
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
        <button className="session-cell-select" onClick={startEditing} type="button">
          {displayRoleAssigneeText(markCoachNames(effectiveValue, options, coachOptions), "배정필요")}
        </button>
      </td>
    );
  }

  return (
    <td className="round-resource-cell editing">
      <div className="round-resource-cell-edit-form">
        <NameSelectEditor
          fieldName="onsiteOm"
          label="현장운영"
          onChange={setDraft}
          options={options}
          secondary={{ label: "외부인력", options: coachOptions, primaryLabel: "OM" }}
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
    if (!confirm("현장운영을 수정하시겠습니까?")) return;

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

// 화면에서만 외부인력(실습코치 명단) 이름 뒤에 "(외부인력)"을 붙여 OM과 구분한다. 저장값은 이름 그대로다.
// OM 명단에도 있는 이름은 OM으로 본다.
function markCoachNames(value: string, omOptions: string[], coachOptions: string[]): string {
  return value
    .split(",")
    .map((name) => name.trim())
    .map((name) => (name && !omOptions.includes(name) && coachOptions.includes(name) ? `${name}(외부인력)` : name))
    .join(", ");
}
