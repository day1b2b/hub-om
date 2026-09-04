"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MultiDateCalendar } from "@/components/MultiDateCalendar";
import { NameCombobox } from "@/components/NameCombobox";
import { deriveDateRangeFromEducationDates } from "@/lib/data/operationCalculations";
import { isValidTimeRangeText, normalizeTimeRangeText } from "./parsePastedRounds";

type SaveState = "idle" | "saving" | "failed";

interface AddRoundButtonProps {
  baseCoach: string;
  baseInstructors: string;
  baseOperationId: string;
  baseRegion: string;
  baseTimeText: string;
  instructorOptions?: string[];
  /** 쓸 수 있는 회차 번호(빈 자리 + 다음 번호). 오름차순. 마지막 값이 "다음 회차"다. */
  roundNoOptions: string[];
}

interface RoundDraft {
  coach: string;
  educationDates: string[];
  instructors: string;
  region: string;
  roundNo: string;
  timeText: string;
}

export function AddRoundButton({
  baseCoach,
  baseInstructors,
  baseOperationId,
  baseRegion,
  baseTimeText,
  instructorOptions = [],
  roundNoOptions
}: AddRoundButtonProps) {
  // 빈 자리가 없으면 다음 번호 하나뿐이다. 그때는 예전처럼 고정 표시한다.
  const nextRoundNo = roundNoOptions[roundNoOptions.length - 1] ?? "1";
  const gapRoundNumbers = roundNoOptions.slice(0, -1);
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
          <section
            aria-labelledby="add-round-title"
            className="drive-review-dialog add-round-dialog round-fields-dialog add-round-create-dialog"
          >

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
                {gapRoundNumbers.length > 0 ? (
                  <>
                    <select
                      onChange={(event) => setDraft((current) => ({ ...current, roundNo: event.target.value }))}
                      value={draft.roundNo}
                    >
                      {gapRoundNumbers.map((option) => (
                        <option key={option} value={option}>
                          {option}회차 (빈 자리)
                        </option>
                      ))}
                      <option value={nextRoundNo}>{nextRoundNo}회차 (마지막에 추가)</option>
                    </select>
                    <small className="add-round-hint">
                      비어 있는 회차: {gapRoundNumbers.join(", ")}회차
                    </small>
                  </>
                ) : (
                  <input readOnly type="text" value={draft.roundNo} />
                )}
              </label>

              <div className="add-round-layout">
                <label className="lecture-note-field add-round-calendar-field">
                  <span>교육일 (달력에서 실제 교육이 있는 날짜만 클릭)</span>
                  <MultiDateCalendar
                    onChange={(dates) => setDraft((current) => ({ ...current, educationDates: dates }))}
                    value={draft.educationDates}
                  />
                </label>

                <div className="add-round-side-fields">
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
      educationDates: [],
      instructors: baseInstructors,
      region: baseRegion,
      roundNo: nextRoundNo,
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
    if (!draft.roundNo.trim() || draft.educationDates.length === 0) {
      setError("회차와 교육일(최소 1일)은 필수입니다.");
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

    const range = deriveDateRangeFromEducationDates(draft.educationDates)!;
    const normalizedDraft = {
      ...draft,
      educationDates: draft.educationDates.join(", "),
      startDate: range.startDate,
      endDate: range.endDate,
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
