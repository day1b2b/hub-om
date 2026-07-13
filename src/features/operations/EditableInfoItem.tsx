"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SaveState = "idle" | "saving" | "failed";

interface EditableInfoItemField {
  name: string;
  placeholder?: string;
  type?: "date" | "text";
  value: string;
}

interface EditableInfoItemProps {
  displayValue: string;
  fields: EditableInfoItemField[];
  label: string;
  operationId: string;
}

export function EditableInfoItem({ displayValue, fields, label, operationId }: EditableInfoItemProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState(() => toDraftValues(fields));
  const [saveState, setSaveState] = useState<SaveState>("idle");

  if (!isEditing) {
    return (
      <div className="info-item editable-info-item">
        <span>{label}</span>
        <div className="info-item-value-row">
          <strong>{displayValue}</strong>
          <button className="info-item-edit-trigger" onClick={startEditing} type="button">
            수정
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="info-item editable-info-item editing">
      <span>{label}</span>
      <div className="info-item-edit-form">
        {fields.map((field) => (
          <input
            aria-label={field.name}
            key={field.name}
            onChange={(event) =>
              setDrafts((current) => ({
                ...current,
                [field.name]: event.target.value
              }))
            }
            placeholder={field.placeholder}
            type={field.type === "date" ? "date" : "text"}
            value={drafts[field.name] ?? ""}
          />
        ))}
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
    setDrafts(toDraftValues(fields));
    setSaveState("idle");
    setIsEditing(true);
  }

  function cancelEditing() {
    setDrafts(toDraftValues(fields));
    setSaveState("idle");
    setIsEditing(false);
  }

  async function save() {
    setSaveState("saving");

    const patches = fields.map((field) => ({
      field: field.name,
      action: "replace" as const,
      value: (drafts[field.name] ?? "").trim()
    }));

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

function toDraftValues(fields: EditableInfoItemField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.name, field.value]));
}
