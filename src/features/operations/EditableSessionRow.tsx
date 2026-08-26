"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { NameCombobox } from "@/components/NameCombobox";
import { useEditAllRoundsSignal } from "./EditAllRoundsProvider";

type SaveState = "idle" | "saving" | "failed";

interface EditableSessionRowProps {
  children?: ReactNode;
  coach: string;
  deleteButton?: ReactNode;
  endDate: string;
  instructorOptions?: string[];
  instructors: string;
  operationId: string;
  region: string;
  startDate: string;
  timeText: string;
}

interface SessionDraft {
  coach: string;
  endDate: string;
  instructors: string;
  region: string;
  startDate: string;
  timeText: string;
}

export function EditableSessionRow({
  children,
  coach,
  deleteButton,
  endDate,
  instructorOptions = [],
  instructors,
  operationId,
  region,
  startDate,
  timeText
}: EditableSessionRowProps) {
  const router = useRouter();
  const editAllContext = useEditAllRoundsSignal();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<SessionDraft>(() => toDraft());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const lastEditAllSignal = useRef(editAllContext?.editAllSignal ?? 0);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);

  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    const signal = editAllContext?.editAllSignal;
    if (signal === undefined || signal === lastEditAllSignal.current) {
      return;
    }
    lastEditAllSignal.current = signal;
    startEditing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAllContext?.editAllSignal]);

  useEffect(() => {
    const registerRow = editAllContext?.registerRow;
    const unregisterRow = editAllContext?.unregisterRow;

    if (!registerRow || !unregisterRow) {
      return;
    }

    if (isEditing) {
      registerRow(operationId, () => saveRef.current!());
    } else {
      unregisterRow(operationId);
    }

    return () => unregisterRow(operationId);
  }, [isEditing, operationId, editAllContext?.registerRow, editAllContext?.unregisterRow]);

  return (
    <>
      <td className="session-cell-wrap">{region || "미정"}</td>
      <td>
        <span className="stacked-cell">
          <strong>{startDate} ~ {endDate}</strong>
          <small>{timeText || "시간 미정"}</small>
        </span>
      </td>
      <td>{instructors || "미정"}</td>
      <td>{coach || "미정"}</td>
      {children}
      <td>
        <button className="session-row-edit-trigger" onClick={startEditing} type="button">
          수정
        </button>
      </td>
      {isEditing
        ? createPortal(
            <div aria-modal="true" className="drive-review-modal" role="dialog">
              <div className="drive-review-backdrop" onClick={cancelEditing} />
              <section aria-labelledby="edit-round-title" className="drive-review-dialog add-round-dialog round-fields-dialog">
                <div className="drive-review-header">
                  <div>
                    <h2 id="edit-round-title">회차 수정</h2>
                  </div>
                  <button aria-label="회차 수정 닫기" onClick={cancelEditing} type="button">
                    닫기
                  </button>
                </div>

                <div className="lecture-note-body">
                  <div className="lecture-note-row">
                    <label className="lecture-note-field">
                      <span>시작일</span>
                      <input
                        onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))}
                        type="date"
                        value={draft.startDate}
                      />
                    </label>
                    <label className="lecture-note-field">
                      <span>종료일</span>
                      <input
                        onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))}
                        type="date"
                        value={draft.endDate}
                      />
                    </label>
                  </div>

                  <div className="lecture-note-row">
                    <label className="lecture-note-field">
                      <span>시간</span>
                      <input
                        onChange={(event) => setDraft((current) => ({ ...current, timeText: event.target.value }))}
                        placeholder="예: 09:30 ~ 17:30"
                        type="text"
                        value={draft.timeText}
                      />
                    </label>
                    <label className="lecture-note-field">
                      <span>장소</span>
                      <input
                        onChange={(event) => setDraft((current) => ({ ...current, region: event.target.value }))}
                        placeholder="예: 서울 강남"
                        type="text"
                        value={draft.region}
                      />
                    </label>
                  </div>

                  <div className="lecture-note-row">
                    <label className="lecture-note-field">
                      <span>강사</span>
                      <NameCombobox
                        options={instructorOptions}
                        onChange={(value) => setDraft((current) => ({ ...current, instructors: value }))}
                        placeholder="강사명"
                        unmatchedHint="등록된 강사 명단과 이름이 달라요. 강사DB 노션을 확인해주세요."
                        value={draft.instructors}
                      />
                    </label>
                    <label className="lecture-note-field">
                      <span>실습코치</span>
                      <input
                        onChange={(event) => setDraft((current) => ({ ...current, coach: event.target.value }))}
                        placeholder="실습코치명"
                        type="text"
                        value={draft.coach}
                      />
                    </label>
                  </div>
                </div>

                <div className="lecture-note-footer">
                  <div className="lecture-note-footer-start">
                    {deleteButton}
                    {saveState === "failed" ? <span className="lecture-note-save-error">저장하지 못했습니다.</span> : null}
                  </div>
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
    </>
  );

  function toDraft(): SessionDraft {
    return { coach, endDate, instructors, region, startDate, timeText };
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

  async function save(): Promise<boolean> {
    setSaveState("saving");

    const patches = [
      { field: "startDate", action: "replace" as const, value: draft.startDate.trim() },
      { field: "endDate", action: "replace" as const, value: draft.endDate.trim() },
      { field: "timeText", action: "replace" as const, value: draft.timeText.trim() },
      { field: "instructors", action: "replace" as const, value: draft.instructors.trim() },
      { field: "coach", action: "replace" as const, value: draft.coach.trim() },
      { field: "region", action: "replace" as const, value: draft.region.trim() }
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
      return false;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean };

    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      return false;
    }

    setIsEditing(false);
    setSaveState("idle");
    router.refresh();
    return true;
  }
}
