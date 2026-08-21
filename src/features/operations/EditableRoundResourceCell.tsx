"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { isNavigableHref, toHref } from "@/lib/links";

type SaveState = "idle" | "saving" | "failed";

interface ResourcePatch {
  field: string;
  action: "replace";
  value: string;
}

interface EditableRoundResourceCellProps {
  companionDoneValue?: string;
  companionField?: string;
  companionMissingValue?: string;
  done: boolean;
  field: string;
  label: string;
  operationId: string;
  value: string;
}

export function EditableRoundResourceCell({
  companionDoneValue,
  companionField,
  companionMissingValue,
  done,
  field,
  label,
  operationId,
  value
}: EditableRoundResourceCellProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const hasHref = isNavigableHref(value);
  const titleId = `round-resource-title-${field}-${operationId}`;

  return (
    <td className="round-resource-cell">
      <div className="round-resource-cell-view">
        {hasHref ? (
          <a aria-label="등록 정보 확인" className="table-link-icon" href={toHref(value) ?? value} rel="noreferrer" target="_blank">
            ↗
          </a>
        ) : null}
        <button className="round-resource-edit-trigger" onClick={startEditing} type="button">
          {done ? "수정" : "등록"}
        </button>
      </div>
      {isEditing
        ? createPortal(
            <div aria-modal="true" className="drive-review-modal" role="dialog">
              <div className="drive-review-backdrop" onClick={cancelEditing} />
              <section aria-labelledby={titleId} className="drive-review-dialog add-round-dialog">
                <div className="drive-review-header">
                  <div>
                    <h2 id={titleId}>{label} 등록</h2>
                  </div>
                  <button aria-label={`${label} 등록 닫기`} onClick={cancelEditing} type="button">
                    닫기
                  </button>
                </div>

                <div className="lecture-note-body">
                  <label className="lecture-note-field">
                    <span>{label} 링크</span>
                    <input
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="https://"
                      type="text"
                      value={draft}
                    />
                  </label>
                </div>

                <div className="lecture-note-footer">
                  {saveState === "failed" ? <span className="lecture-note-save-error">저장하지 못했습니다.</span> : null}
                  <div className="lecture-note-actions">
                    <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
                      취소
                    </button>
                    <button disabled={saveState === "saving"} onClick={save} type="button">
                      {saveState === "saving" ? "저장 중" : "저장"}
                    </button>
                  </div>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </td>
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
