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
  /** 있으면(코치 셀) 선택 이름을 위키 coachId로 풀어 투입(engagement)까지 반영한다. 동명이인(맵에 없음)은 제외. */
  nameToId?: Record<string, string>;
}

export function EditableSessionNamesCell({
  field,
  label,
  operationId,
  options,
  placeholder,
  unmatchedHint,
  value,
  nameToId
}: EditableSessionNamesCellProps) {
  const router = useRouter();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  return (
    <td className="round-resource-cell">
      <button className="session-cell-select" onClick={startEditing} ref={anchorRef} type="button">
        {value || "미정"}
      </button>
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

    // 코치 셀(nameToId 있음): 선택 이름을 위키 coachId로 해석한다. 동명이인(유일 맵에 없음)이 섞여 있으면
    // 어느 코치인지 특정할 수 없어 투입을 정확히 연결할 수 없다 → 저장을 막고 노션 정리를 유도한다
    // (앱이 추측해 때우지 않음 — 노션이 이름의 원천). 강사 셀은 nameToId가 없어 coachIds=null로 건너뛴다.
    let coachIds: string[] | null = null;
    if (nameToId) {
      const resolved: string[] = [];
      for (const name of names) {
        const key = Object.keys(nameToId).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
        if (!key) {
          setError("동명이인이 있어 투입을 연결할 수 없어요. 노션 실습코치DB에서 A·B로 구분한 뒤 다시 선택해주세요.");
          return;
        }
        resolved.push(nameToId[key]);
      }
      coachIds = resolved;
    }

    if (!confirm(`${label}를 수정하시겠습니까?`)) return;

    setError(null);
    setSaveState("saving");

    // (1) 표시값(coachText) 저장.
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

    // (2) 코치 셀이면 같은 선택의 coachId로 투입(engagement)까지 반영(멱등). 동명이인은 위에서 이미 걸러짐.
    if (coachIds) {
      let engagementOk = false;
      try {
        const engagementResponse = await fetch(`/api/operations/${encodeURIComponent(operationId)}/coaches`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ coachIds })
        });
        const engagementPayload = (await engagementResponse.json().catch(() => ({}))) as { ok?: boolean };
        engagementOk = engagementResponse.ok && engagementPayload.ok === true;
      } catch {
        engagementOk = false;
      }
      if (!engagementOk) {
        // 이름(coachText)은 이미 저장됨 — '총 실패'로 오인하지 않게, 재시도(멱등)를 안내하고
        // 저장된 이름이 보이도록 새로고침한다.
        setError("이름은 저장됐지만 투입 연결에 실패했어요. 다시 저장하면 연결됩니다.");
        setSaveState("idle");
        router.refresh();
        return;
      }
    }

    setIsEditing(false);
    setSaveState("idle");
    router.refresh();
  }
}
