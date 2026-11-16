"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolveEditableInfoTargets } from "./editableInfoTargets";

type SaveState = "idle" | "saving" | "failed";
const OM_NOTIFICATION_FAILED_MESSAGE = "저장됐지만 Slack 배정 알림이 가지 않았습니다. 담당 OM에게 직접 알려주세요.";

interface EditableInfoItemField {
  name: string;
  options?: string[];
  optionGroups?: { label: string; options: string[] }[];
  placeholder?: string;
  type?: "date" | "text" | "name-select" | "select";
  value: string;
}

interface EditableInfoItemProps {
  displayValue: string;
  fields: EditableInfoItemField[];
  label: string;
  operationId: string;
  operationIds?: string[];
}

export function EditableInfoItem({ displayValue, fields, label, operationId, operationIds }: EditableInfoItemProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState(() => toDraftValues(fields));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // Saved, but the OM change did not reach Slack: tell the editor to notify the OM directly.
  const [omNotificationFailed, setOmNotificationFailed] = useState(false);

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
        {omNotificationFailed ? <span className="info-item-save-error" role="alert">{OM_NOTIFICATION_FAILED_MESSAGE}</span> : null}
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
          ) : field.type === "select" ? (
            <select
              aria-label={field.name}
              key={field.name}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [field.name]: event.target.value
                }))
              }
              value={drafts[field.name] ?? ""}
            >
              <option value="">미정</option>
              {field.optionGroups
                ? field.optionGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : (field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
            </select>
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
    setOmNotificationFailed(false);
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

    const results = await Promise.all(
      resolveEditableInfoTargets(operationId, operationIds).map(async (targetOperationId) => {
        try {
          const response = await fetch(`/api/operations/${encodeURIComponent(targetOperationId)}/drive-import/apply`, {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({ patches })
          });
          const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; omNotification?: string };
          return { saved: response.ok && payload.ok === true, notificationFailed: payload.omNotification === "failed" };
        } catch {
          return { saved: false, notificationFailed: false };
        }
      })
    );

    setOmNotificationFailed(results.some((result) => result.notificationFailed));
    if (!results.every((result) => result.saved)) {
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
  /** 가끔만 쓰는 두 번째 명단. 주면 줄마다 [기본 | 두 번째] 버튼이 생기고, 누른 쪽 명단만 보여준다. */
  secondary?: { label: string; options: string[]; primaryLabel: string };
  value: string;
}

export function NameSelectEditor({ fieldName, label, onChange, options, secondary, value }: NameSelectEditorProps) {
  const [names, setNames] = useState(() => splitNames(value));
  // 줄마다 어느 명단에서 고르는지. 이미 저장된 이름이 두 번째 명단에만 있으면 그쪽으로 연다.
  const [useSecondary, setUseSecondary] = useState(() =>
    names.map((name) => !!secondary && !!name && !options.includes(name) && secondary.options.includes(name))
  );
  const hasAnyOption = options.length > 0 || (secondary?.options.length ?? 0) > 0;

  return (
    <div className="name-select-list">
      {names.map((name, index) => {
        const rowOptions = useSecondary[index] && secondary ? secondary.options : options;

        return (
          <div className={secondary ? "name-select-row has-source-toggle" : "name-select-row"} key={`${fieldName}-${index}`}>
            {secondary ? (
              <div className="name-source-toggle" role="group" aria-label={`${label} ${index + 1} 명단`}>
                <button aria-pressed={!useSecondary[index]} onClick={() => switchSource(index, false)} type="button">
                  {secondary.primaryLabel}
                </button>
                <button aria-pressed={!!useSecondary[index]} onClick={() => switchSource(index, true)} type="button">
                  {secondary.label}
                </button>
              </div>
            ) : null}
            <select
              aria-label={`${label} ${index + 1}`}
              disabled={rowOptions.length === 0}
              onChange={(event) => updateName(index, event.target.value)}
              value={name}
            >
              <option value="">{rowOptions.length === 0 ? "선택 가능한 이름 없음" : "선택"}</option>
              {rowOptions.map((option) => (
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
              <button className="name-add-button" disabled={!hasAnyOption} onClick={addName} type="button">
                +
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  // onChange는 상태 업데이트 함수 밖에서 부른다. 안에서 부르면 렌더 중 부모 상태를 바꿔 React 경고가 난다.
  function commit(next: string[]) {
    setNames(next);
    onChange(joinNames(next));
  }

  function addName() {
    setUseSecondary((current) => [...current, false]);
    commit([...names, ""]);
  }

  function removeName(index: number) {
    setUseSecondary((current) => current.filter((_, currentIndex) => currentIndex !== index));
    commit(names.filter((_, currentIndex) => currentIndex !== index));
  }

  // 명단을 바꾸면 그 줄에 고른 이름은 비운다. 다른 명단의 이름이 남아 있으면 select가 엉뚱하게 보인다.
  function switchSource(index: number, nextUseSecondary: boolean) {
    if (!!useSecondary[index] === nextUseSecondary) return;
    setUseSecondary((current) => current.map((flag, currentIndex) => (currentIndex === index ? nextUseSecondary : flag)));
    updateName(index, "");
  }

  function updateName(index: number, nextName: string) {
    commit(names.map((name, currentIndex) => (currentIndex === index ? nextName : name)));
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
