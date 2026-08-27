"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NameCombobox } from "@/components/NameCombobox";
import { isValidTimeRangeText, normalizeTimeRangeText } from "./parsePastedRounds";

type SaveState = "idle" | "saving" | "failed";

interface AddRoundButtonProps {
  baseCoach: string;
  baseInstructors: string;
  baseOperationId: string;
  baseRegion: string;
  baseTimeText: string;
  instructorOptions?: string[];
  nextRoundNo: string;
}

interface RoundDraft {
  coach: string;
  endDate: string;
  instructors: string;
  region: string;
  roundNo: string;
  startDate: string;
  timeText: string;
}

export function AddRoundButton({
  baseCoach,
  baseInstructors,
  baseOperationId,
  baseRegion,
  baseTimeText,
  instructorOptions = [],
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
        + 회차 추가
      </button>

      {isOpen ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={closeDialog} />
          <section aria-labelledby="add-round-title" className="drive-review-dialog add-round-dialog round-fields-dialog">
            <div className="drive-review-header">
              <div>
                <h2 id="add-round-title">회차 추가</h2>
                <p>동일 과정에 새 회차를 추가합니다.</p>
              </div>
              <button aria-label="회차 추가 닫기" onClick={closeDialog} type="button">
                닫기
              </button>
            </div>

            <div className="lecture-note-body">
              <label className="lecture-note-field">
                <span>회차</span>
                <input readOnly type="text" value={draft.roundNo} />
              </label>

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
    return {
      coach: baseCoach,
      endDate: "",
      instructors: baseInstructors,
      region: baseRegion,
      roundNo: nextRoundNo,
      startDate: "",
      timeText: baseTimeText
    };
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

    if (draft.timeText.trim() && !isValidTimeRangeText(draft.timeText)) {
      setError("시간 형식을 확인해주세요 (예: 09:30 ~ 17:30).");
      return;
    }

    const instructorName = draft.instructors.trim();
    if (instructorName && !instructorOptions.some((name) => name.toLowerCase() === instructorName.toLowerCase())) {
      setError("등록된 강사 명단과 이름이 달라요. 강사DB 노션을 확인해주세요.");
      return;
    }

    setSaveState("saving");
    setError(null);

    const normalizedDraft = {
      ...draft,
      timeText: draft.timeText.trim() ? normalizeTimeRangeText(draft.timeText) : draft.timeText
    };

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(baseOperationId)}/rounds`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(normalizedDraft)
      });
    } catch {
      setSaveState("failed");
      setError("회차를 추가하지 못했습니다.");
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      setError(payload.error ?? "회차를 추가하지 못했습니다.");
      return;
    }

    setIsOpen(false);
    setSaveState("idle");
    router.refresh();
  }
}
