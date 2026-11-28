"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NameCombobox } from "@/components/NameCombobox";
import { SessionFieldPopover } from "./SessionFieldPopover";

type SaveState = "idle" | "saving" | "failed";

// ②/S2: 명단에 없는 코치를 노션 링크로 바로 추가하는 흐름. '[노션 코치DB에 등록]' 버튼이 열 주소(노션 실습코치 DB).
const COACH_NOTION_DB_URL = "https://app.notion.com/p/3b84576d6ffa802d9e23db654f1b31cd?v=f0bb25c4d78349e586fd7630f68f457a";

interface EditableSessionNamesCellProps {
  field: "coach" | "instructors";
  label: string;
  operationId: string;
  options: string[];
  placeholder: string;
  unmatchedHint: string;
  value: string;
  /** 있으면(코치·강사 셀) 선택 이름을 위키 ID(coachId / InstructorNote.id)로 풀어 투입(engagement)까지 반영한다. 동명이인(맵에 없음)은 제외. */
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
  const [linkDraft, setLinkDraft] = useState("");
  const [addState, setAddState] = useState<"idle" | "adding">("idle");
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [addFailed, setAddFailed] = useState(false);

  function resetAddByLink() {
    setLinkDraft("");
    setAddState("idle");
    setAddMessage(null);
    setAddFailed(false);
  }

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
            {field === "coach" ? (
              <div className="session-coach-add">
                <span className="session-coach-add-title">명단에 없나요?</span>
                <a className="session-coach-add-link" href={COACH_NOTION_DB_URL} rel="noreferrer" target="_blank">
                  노션 코치DB에 등록
                </a>
                <div className="session-coach-add-row">
                  <input
                    className="session-coach-add-input"
                    onChange={(event) => setLinkDraft(event.target.value)}
                    placeholder="등록 후 노션 '페이지 링크' 붙여넣기"
                    value={linkDraft}
                  />
                  <button disabled={addState === "adding" || !linkDraft.trim()} onClick={addByLink} type="button">
                    {addState === "adding" ? "추가 중" : "추가"}
                  </button>
                </div>
                {addMessage ? <span className={addFailed ? "lecture-note-save-error" : "session-coach-add-message"}>{addMessage}</span> : null}
              </div>
            ) : null}
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
    resetAddByLink();
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(value);
    setSaveState("idle");
    setError(null);
    setIsEditing(false);
  }

  async function addByLink() {
    const link = linkDraft.trim();
    if (!link) return;
    setAddState("adding");
    setAddMessage(null);
    setAddFailed(false);
    try {
      const response = await fetch("/api/coaches/add-by-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; name?: string; error?: string };
      if (!response.ok || !payload.ok) {
        setAddState("idle");
        setAddFailed(true);
        setAddMessage(payload.error ?? "추가하지 못했어요. 노션 페이지 링크를 확인해주세요.");
        return;
      }
      // 추가된 코치가 명단(options)에 뜨도록 새로고침 → OM이 바로 선택.
      setAddState("idle");
      setLinkDraft("");
      setAddMessage(`${payload.name ?? "코치"} 추가됨 — 목록에서 선택해주세요.`);
      router.refresh();
    } catch {
      setAddState("idle");
      setAddFailed(true);
      setAddMessage("추가하지 못했어요. 다시 시도해주세요.");
    }
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

    // nameToId 있는 셀(코치·강사): 선택 이름을 위키 ID(coachId / InstructorNote.id)로 해석한다. 동명이인(유일 맵에
    // 없음)이 섞여 있으면 어느 사람인지 특정할 수 없어 투입을 정확히 연결할 수 없다 → 저장을 막고 노션 정리를 유도한다
    // (앱이 추측해 때우지 않음 — 노션이 이름의 원천).
    const homonymDbLabel = field === "coach" ? "노션 실습코치DB" : "강사DB 노션";
    let resolvedIds: string[] | null = null;
    if (nameToId) {
      const resolved: string[] = [];
      for (const name of names) {
        const key = Object.keys(nameToId).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
        if (!key) {
          setError(`동명이인이 있어 투입을 연결할 수 없어요. ${homonymDbLabel}에서 A·B로 구분한 뒤 다시 선택해주세요.`);
          return;
        }
        resolved.push(nameToId[key]);
      }
      resolvedIds = resolved;
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

    // (2) nameToId 셀이면 같은 선택의 ID로 투입(engagement)까지 반영(멱등). 동명이인은 위에서 이미 걸러짐.
    //     코치→/coaches {coachIds}, 강사→/instructors {instructorNoteIds}.
    if (resolvedIds) {
      const engagementPath = field === "coach" ? "coaches" : "instructors";
      const engagementBody = field === "coach" ? { coachIds: resolvedIds } : { instructorNoteIds: resolvedIds };
      let engagementOk = false;
      try {
        const engagementResponse = await fetch(`/api/operations/${encodeURIComponent(operationId)}/${engagementPath}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(engagementBody)
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
