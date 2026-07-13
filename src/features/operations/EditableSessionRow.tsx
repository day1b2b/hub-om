"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditAllRoundsSignal } from "./EditAllRoundsProvider";

type SaveState = "idle" | "saving" | "failed";

interface EditableSessionRowProps {
  coach: string;
  endDate: string;
  instructors: string;
  operationId: string;
  startDate: string;
  timeText: string;
}

interface SessionDraft {
  coach: string;
  endDate: string;
  instructors: string;
  startDate: string;
  timeText: string;
}

export function EditableSessionRow({ coach, endDate, instructors, operationId, startDate, timeText }: EditableSessionRowProps) {
  const router = useRouter();
  const editAllContext = useEditAllRoundsSignal();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<SessionDraft>(() => toDraft());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const lastEditAllSignal = useRef(editAllContext?.editAllSignal ?? 0);

  useEffect(() => {
    const signal = editAllContext?.editAllSignal;
    if (signal === undefined || signal === lastEditAllSignal.current) {
      return;
    }
    lastEditAllSignal.current = signal;
    startEditing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAllContext?.editAllSignal]);

  if (!isEditing) {
    return (
      <>
        <td>
          <span className="stacked-cell">
            <strong>{startDate} ~ {endDate}</strong>
            <small>{timeText || "시간 미정"}</small>
          </span>
        </td>
        <td>{instructors || "미정"}</td>
        <td>{coach || "미정"}</td>
        <td>
          <button className="session-row-edit-trigger" onClick={startEditing} type="button">
            수정
          </button>
        </td>
      </>
    );
  }

  return (
    <>
      <td colSpan={3}>
        <div className="session-row-edit-form">
          <label className="session-row-edit-field">
            <span>일정</span>
            <span className="session-row-edit-date-range">
              <input
                aria-label="시작일"
                onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))}
                type="date"
                value={draft.startDate}
              />
              <span>~</span>
              <input
                aria-label="종료일"
                onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))}
                type="date"
                value={draft.endDate}
              />
            </span>
          </label>
          <label className="session-row-edit-field">
            <span>시간</span>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, timeText: event.target.value }))}
              placeholder="예: 09:30 ~ 17:30"
              type="text"
              value={draft.timeText}
            />
          </label>
          <label className="session-row-edit-field">
            <span>강사</span>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, instructors: event.target.value }))}
              placeholder="강사명"
              type="text"
              value={draft.instructors}
            />
          </label>
          <label className="session-row-edit-field">
            <span>실습코치</span>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, coach: event.target.value }))}
              placeholder="실습코치명"
              type="text"
              value={draft.coach}
            />
          </label>
        </div>
        {saveState === "failed" ? <span className="archive-item-save-error">저장하지 못했습니다.</span> : null}
      </td>
      <td>
        <div className="session-row-edit-actions">
          <button disabled={saveState === "saving"} onClick={save} type="button">
            {saveState === "saving" ? "저장 중" : "저장"}
          </button>
          <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
            취소
          </button>
        </div>
      </td>
    </>
  );

  function toDraft(): SessionDraft {
    return { coach, endDate, instructors, startDate, timeText };
  }

  function startEditing() {
    setDraft(toDraft());
    setSaveState("idle");
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(toDraft());
    setSaveState("idle");
    setIsEditing(false);
  }

  async function save() {
    setSaveState("saving");

    const patches = [
      { field: "startDate", action: "replace" as const, value: draft.startDate.trim() },
      { field: "endDate", action: "replace" as const, value: draft.endDate.trim() },
      { field: "timeText", action: "replace" as const, value: draft.timeText.trim() },
      { field: "instructors", action: "replace" as const, value: draft.instructors.trim() },
      { field: "coach", action: "replace" as const, value: draft.coach.trim() }
    ];

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
