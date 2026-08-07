"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SaveState = "idle" | "saving" | "failed";

interface EditableInfoItemField {
  name: string;
  options?: string[];
  placeholder?: string;
  type?: "date" | "text" | "name-select";
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
        {fields.map((field) =>
          field.type === "name-select" ? (
            <NameSelectEditor
              fieldName={field.name}
              key={field.name}
              label={label}
              onChange={(nextValue) =>
                setDrafts((current) => ({
                  ...current,
                  [field.name]: nextValue
                }))
              }
              options={field.options ?? []}
              value={drafts[field.name] ?? ""}
            />
          ) : (
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
          )
        )}
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

interface NameSelectEditorProps {
  fieldName: string;
  label: string;
  onChange: (nextValue: string) => void;
  options: string[];
  value: string;
}

function NameSelectEditor({ fieldName, label, onChange, options, value }: NameSelectEditorProps) {
  const [names, setNames] = useState(() => splitNames(value));

  return (
    <div className="name-select-list">
      {names.map((name, index) => (
        <div className="name-select-row" key={`${fieldName}-${index}`}>
          <select
            aria-label={`${label} ${index + 1}`}
            disabled={options.length === 0}
            onChange={(event) => updateName(index, event.target.value)}
            value={name}
          >
            <option value="">{options.length === 0 ? "선택 가능한 이름 없음" : "선택"}</option>
            {options.map((option) => (
              <option disabled={names.includes(option) && option !== name} key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {names.length > 1 ? (
            <button className="name-remove-button" onClick={() => removeName(index)} type="button">
              삭제
            </button>
          ) : null}
          {index === names.length - 1 ? (
            <button className="name-add-button" disabled={options.length === 0} onClick={addName} type="button">
              +
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );

  function addName() {
    setNames((current) => {
      const next = [...current, ""];
      onChange(joinNames(next));
      return next;
    });
  }

  function removeName(index: number) {
    setNames((current) => {
      const next = current.filter((_, currentIndex) => currentIndex !== index);
      onChange(joinNames(next));
      return next;
    });
  }

  function updateName(index: number, nextName: string) {
    setNames((current) => {
      const next = current.map((name, currentIndex) => (currentIndex === index ? nextName : name));
      onChange(joinNames(next));
      return next;
    });
  }
}

function splitNames(value: string): string[] {
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return names.length > 0 ? names : [""];
}

function joinNames(names: string[]): string {
  return names.filter(Boolean).join(", ");
}
