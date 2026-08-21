"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OnsiteRequired } from "@/lib/data/operationTypes";

type SaveState = "idle" | "saving" | "failed";
type Choice = "Y" | "N";

interface RoundOnsiteRequired {
  onsiteRequired: OnsiteRequired;
  operationId: string;
}

interface OnsiteRequiredConditionSelectProps {
  rounds: RoundOnsiteRequired[];
}

export function OnsiteRequiredConditionSelect({ rounds }: OnsiteRequiredConditionSelectProps) {
  const router = useRouter();
  const allRequired = rounds.every((round) => round.onsiteRequired === "Y");
  const allNotRequired = rounds.every((round) => round.onsiteRequired === "N");
  const currentValue = allRequired ? "Y" : allNotRequired ? "N" : "회차별로 다름";

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Choice>(allNotRequired ? "N" : "Y");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  if (!isEditing) {
    return (
      <div className="info-item editable-info-item">
        <span>현장 투입</span>
        <div className="info-item-value-row">
          <strong>{currentValue}</strong>
          <button className="info-item-edit-trigger" onClick={startEditing} type="button">
            수정
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="info-item editable-info-item editing">
      <span>현장 투입</span>
      <div className="info-item-edit-form">
        <select aria-label="현장 투입" onChange={(event) => setDraft(event.target.value as Choice)} value={draft}>
          <option value="Y">Y</option>
          <option value="N">N</option>
        </select>
        <div className="info-item-edit-actions">
          <button disabled={saveState === "saving"} onClick={save} type="button">
            {saveState === "saving" ? "저장 중" : "저장"}
          </button>
          <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
            취소
          </button>
        </div>
      </div>
      {saveState === "failed" ? <span className="info-item-save-error">저장하지 못했습니다.</span> : null}
    </div>
  );

  function startEditing() {
    setDraft(allNotRequired ? "N" : "Y");
    setSaveState("idle");
    setIsEditing(true);
  }

  function cancelEditing() {
    setSaveState("idle");
    setIsEditing(false);
  }

  async function save() {
    setSaveState("saving");

    const targets = rounds.filter((round) => round.onsiteRequired !== draft);

    const results = await Promise.all(
      targets.map((round) =>
        fetch(`/api/operations/${encodeURIComponent(round.operationId)}/drive-import/apply`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ patches: [{ field: "onsiteRequired", action: "replace", value: draft }] })
        })
          .then((response) => response.ok)
          .catch(() => false)
      )
    );

    if (!results.every(Boolean)) {
      setSaveState("failed");
      return;
    }

    setIsEditing(false);
    setSaveState("idle");
    router.refresh();
  }
}
