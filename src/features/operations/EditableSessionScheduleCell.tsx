"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MultiDateCalendar } from "@/components/MultiDateCalendar";
import {
  deriveDateRangeFromEducationDates,
  enumerateDateRange,
  formatEducationDatesList
} from "@/lib/data/operationCalculations";
import { SessionFieldPopover } from "./SessionFieldPopover";

type SaveState = "idle" | "saving" | "failed";

interface EditableSessionScheduleCellProps {
  educationDates: string[];
  endDate: string;
  operationId: string;
  startDate: string;
  timeText: string;
}

export function EditableSessionScheduleCell({
  educationDates,
  endDate,
  operationId,
  startDate,
  timeText
}: EditableSessionScheduleCellProps) {
  const router = useRouter();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftDates, setDraftDates] = useState(() => toDraftDates());
  const [draftTime, setDraftTime] = useState(timeText);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  return (
    <td>
      <button className="session-cell-select stacked-cell" onClick={startEditing} ref={anchorRef} type="button">
        <strong>{educationDates.length > 0 ? formatEducationDatesList(educationDates) : `${startDate} ~ ${endDate}`}</strong>
        <strong>{timeText || "시간 미정"}</strong>
        {educationDates.length > 0 ? <small>{startDate} ~ {endDate}</small> : null}
      </button>
      {isEditing ? (
        <SessionFieldPopover anchorRef={anchorRef} onClose={cancelEditing}>
          <div className="session-field-popover-body">
            <label className="lecture-note-field lecture-note-field-block">
              <span>교육일 (달력에서 실제 교육이 있는 날짜만 클릭)</span>
              <MultiDateCalendar onChange={setDraftDates} value={draftDates} />
            </label>
            <label className="lecture-note-field">
              <span>시간</span>
              <input
                onChange={(event) => setDraftTime(event.target.value)}
                placeholder="예: 09:30 ~ 17:30"
                type="text"
                value={draftTime}
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

  function toDraftDates() {
    return educationDates.length > 0 ? educationDates : enumerateDateRange(startDate, endDate);
  }

  function startEditing() {
    setDraftDates(toDraftDates());
    setDraftTime(timeText);
    setSaveState("idle");
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraftDates(toDraftDates());
    setDraftTime(timeText);
    setSaveState("idle");
    setError(null);
    setIsEditing(false);
  }

  async function save() {
    if (draftDates.length === 0) {
      setError("교육일을 최소 1일 선택해주세요.");
      return;
    }

    if (!confirm("일정/시간을 수정하시겠습니까?")) return;

    setError(null);
    setSaveState("saving");

    const range = deriveDateRangeFromEducationDates(draftDates)!;
    const patches = [
      { field: "startDate", action: "replace" as const, value: range.startDate },
      { field: "endDate", action: "replace" as const, value: range.endDate },
      { field: "educationDates", action: "replace" as const, value: draftDates.join(", ") },
      { field: "timeText", action: "replace" as const, value: draftTime.trim() }
    ];

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
