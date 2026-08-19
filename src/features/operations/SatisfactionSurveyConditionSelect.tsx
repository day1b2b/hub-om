"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SatisfactionSurveyStatus } from "@/lib/data/operationTypes";

type SaveState = "idle" | "saving" | "failed";
type Choice = "Y" | "N";

interface RoundSatisfactionSurveyStatus {
  hasSatisfactionSurvey: SatisfactionSurveyStatus;
  operationId: string;
}

interface SatisfactionSurveyConditionSelectProps {
  rounds: RoundSatisfactionSurveyStatus[];
}

export function SatisfactionSurveyConditionSelect({ rounds }: SatisfactionSurveyConditionSelectProps) {
  const router = useRouter();
  const allRequired = rounds.every((round) => round.hasSatisfactionSurvey !== "불필요");
  const allNotRequired = rounds.every((round) => round.hasSatisfactionSurvey === "불필요");
  const currentValue = allRequired ? "Y" : allNotRequired ? "N" : "회차별로 다름";

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Choice>(allNotRequired ? "N" : "Y");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  if (!isEditing) {
    return (
      <div className="info-item editable-info-item">
        <span>만족도 조사 여부</span>
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
      <span>만족도 조사 여부</span>
      <div className="info-item-edit-form">
        <select aria-label="만족도 조사 여부" onChange={(event) => setDraft(event.target.value as Choice)} value={draft}>
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

    const nextValue: SatisfactionSurveyStatus = draft === "N" ? "불필요" : "확인필요";
    const targets = rounds.filter((round) => (draft === "N") === (round.hasSatisfactionSurvey !== "불필요"));

    const results = await Promise.all(
      targets.map((round) =>
        fetch(`/api/operations/${encodeURIComponent(round.operationId)}/drive-import/apply`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ patches: [{ field: "hasSatisfactionSurvey", action: "replace", value: nextValue }] })
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
