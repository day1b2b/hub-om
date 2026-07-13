"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isNavigableHref, toHref } from "@/lib/links";

type SaveState = "idle" | "saving" | "failed";

interface ResourcePatch {
  field: string;
  action: "replace";
  value: string;
}

interface EditableResourceRowProps {
  companionDoneValue?: string;
  companionField?: string;
  companionMissingValue?: string;
  done: boolean;
  doneText: string;
  field: string;
  isLink: boolean;
  label: string;
  missingText: string;
  operationId: string;
  placeholder?: string;
  value: string;
}

export function EditableResourceRow({
  companionDoneValue,
  companionField,
  companionMissingValue,
  done,
  doneText,
  field,
  isLink,
  label,
  missingText,
  operationId,
  placeholder,
  value
}: EditableResourceRowProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const hasHref = isLink && isNavigableHref(value);

  if (!isEditing) {
    return (
      <div className={`archive-item-row ${done ? "done" : "missing"}`}>
        <strong>{label}</strong>
        <div className="archive-item-actions">
          {hasHref ? (
            <a className="archive-item-state" href={toHref(value) ?? value} rel="noreferrer" target="_blank">
              열기
            </a>
          ) : (
            <span className="archive-item-state">{done ? doneText : missingText}</span>
          )}
          <button className="archive-item-edit-trigger" onClick={startEditing} type="button">
            수정
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="archive-item-row editing">
      <strong>{label}</strong>
      <div className="archive-item-edit-form">
        <input
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          type="text"
          value={draft}
        />
        <button disabled={saveState === "saving"} onClick={save} type="button">
          {saveState === "saving" ? "저장 중" : "저장"}
        </button>
        <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
          취소
        </button>
      </div>
      {saveState === "failed" ? <span className="archive-item-save-error">저장하지 못했습니다.</span> : null}
    </div>
  );

  function startEditing() {
    setDraft(value);
    setSaveState("idle");
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(value);
    setSaveState("idle");
    setIsEditing(false);
  }

  async function save() {
    setSaveState("saving");

    const trimmed = draft.trim();
    const patches: ResourcePatch[] = [{ field, action: "replace", value: trimmed }];

    if (companionField && companionDoneValue && companionMissingValue) {
      patches.push({
        field: companionField,
        action: "replace",
        value: trimmed ? companionDoneValue : companionMissingValue
      });
    }

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ patches })
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
