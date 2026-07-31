"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SaveState = "idle" | "saving" | "failed";

interface AddRoundButtonProps {
  baseCoach: string;
  baseInstructors: string;
  baseOperationId: string;
  baseTimeText: string;
  nextRoundNo: string;
}

interface RoundDraft {
  coach: string;
  endDate: string;
  instructors: string;
  roundNo: string;
  startDate: string;
  timeText: string;
}

export function AddRoundButton({
  baseCoach,
  baseInstructors,
  baseOperationId,
  baseTimeText,
  nextRoundNo
}: AddRoundButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<RoundDraft>(() => toDraft());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button className="secondary-action add-round-trigger" onClick={openDialog} type="button">
        + 차수 추가
      </button>

      {isOpen ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={closeDialog} />
          <section aria-labelledby="add-round-title" className="drive-review-dialog add-round-dialog">
            <div className="drive-review-header">
              <div>
                <h2 id="add-round-title">차수 추가</h2>
                <p>동일 과정에 새 회차를 추가합니다.</p>
              </div>
              <button aria-label="차수 추가 닫기" onClick={closeDialog} type="button">
                닫기
              </button>
            </div>

            <div className="lecture-note-body">
              <label className="lecture-note-field">
                <span>회차</span>
                <input
                  onChange={(event) => setDraft((current) => ({ ...current, roundNo: event.target.value }))}
                  placeholder="예: 5"
                  type="text"
                  value={draft.roundNo}
                />
              </label>

              <div className="add-round-date-row">
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
                <span>강사</span>
                <input
                  onChange={(event) => setDraft((current) => ({ ...current, instructors: event.target.value }))}
                  placeholder="강사명"
                  type="text"
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

            <div className="lecture-note-footer">
              {error ? <span className="lecture-note-save-error">{error}</span> : null}
              <div className="lecture-note-actions">
                <button disabled={saveState === "saving"} onClick={closeDialog} type="button">
                  취소
                </button>
                <button disabled={saveState === "saving"} onClick={save} type="button">
                  {saveState === "saving" ? "추가 중" : "추가"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );

  function toDraft(): RoundDraft {
    return { coach: baseCoach, endDate: "", instructors: baseInstructors, roundNo: nextRoundNo, startDate: "", timeText: baseTimeText };
  }

  function openDialog() {
    setDraft(toDraft());
    setError(null);
    setSaveState("idle");
    setIsOpen(true);
  }

  function closeDialog() {
    setError(null);
    setSaveState("idle");
    setIsOpen(false);
  }

  async function save() {
    if (!draft.roundNo.trim() || !draft.startDate.trim() || !draft.endDate.trim()) {
      setError("회차, 시작일, 종료일은 필수입니다.");
      return;
    }

    setSaveState("saving");
    setError(null);

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(baseOperationId)}/rounds`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(draft)
      });
    } catch {
      setSaveState("failed");
      setError("차수를 추가하지 못했습니다.");
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      setError(payload.error ?? "차수를 추가하지 못했습니다.");
      return;
    }

    setIsOpen(false);
    setSaveState("idle");
    router.refresh();
  }
}
