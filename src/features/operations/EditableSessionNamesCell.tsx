"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NameCombobox } from "@/components/NameCombobox";
import { SessionFieldPopover } from "./SessionFieldPopover";

type SaveState = "idle" | "saving" | "failed";

interface EditableSessionNamesCellProps {
  field: "coach" | "instructors";
  label: string;
  operationId: string;
  options: string[];
  placeholder: string;
  unmatchedHint: string;
  value: string;
}

export function EditableSessionNamesCell({
  field,
  label,
  operationId,
  options,
  placeholder,
  unmatchedHint,
  value
}: EditableSessionNamesCellProps) {
  const router = useRouter();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  return (
    <td className="round-resource-cell">
      <div className="round-resource-cell-view">
        <span>{value || "미정"}</span>
        <button className="round-resource-edit-trigger" onClick={startEditing} ref={anchorRef} type="button">
          수정
        </button>
      </div>
      {isEditing ? (
        <SessionFieldPopover anchorRef={anchorRef} onClose={cancelEditing}>
          <div className="session-field-popover-body">
            <label className="lecture-note-field">
              <span>{label}</span>
              <NameCombobox
                multiple
                onChange={setDraft}
                options={options}
                placeholder={placeholder}
                unmatchedHint={unmatchedHint}
                value={draft}
              />
            </label>
          </div>
          <div className="lecture-note-footer">
            {error ? <span className="lecture-note-save-error">{error}</span> : null}
            {!error && saveState === "failed" ? <span className="lecture-note-save-error">저장하지 못했습니다.</span> : null}
            <div className="lecture-note-actions">
              <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
                취소
              </button>
              <button disabled={saveState === "saving"} onClick={save} type="button">
                {saveState === "saving" ? "저장 중" : "저장"}
              </button>
            </div>
          </div>
        </SessionFieldPopover>
      ) : null}
    </td>
  );

  function startEditing() {
    setDraft(value);
    setSaveState("idle");
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(value);
    setSaveState("idle");
    setError(null);
    setIsEditing(false);
  }

  async function save() {
    const names = draft
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    if (names.some((name) => !options.some((option) => option.toLowerCase() === name.toLowerCase()))) {
      setError(unmatchedHint);
      return;
    }

    setError(null);
    setSaveState("saving");

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patches: [{ field, action: "replace", value: names.join(", ") }] })
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
