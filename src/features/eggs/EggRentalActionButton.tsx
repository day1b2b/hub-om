"use client";

import { useState } from "react";
import type { EggRentalRecord } from "@/lib/data/eggs/eggTypes";
import { callEggApi } from "./eggApi";
import { formatRange } from "./eggDisplay";
import type { EggRunAction } from "./EggRentalBoard";

type RentalTone = "done" | "overdue" | "active" | "upcoming";

export function getRentalStateLabel(
  rental: Pick<EggRentalRecord, "returned" | "startDate" | "returnDueDate">,
  today: string
): { label: string; className: string; tone: RentalTone } {
  if (rental.returned) return { label: "반납 완료", className: "status egg-muted", tone: "done" };
  if (rental.returnDueDate < today) return { label: "반납 지연", className: "status needs-assignment", tone: "overdue" };
  if (rental.startDate > today) return { label: "대여 예정", className: "status done", tone: "upcoming" };
  return { label: "대여 중", className: "status planned-assignment", tone: "active" };
}

interface EggRentalActionButtonProps {
  rental: EggRentalRecord;
  deviceLabel: string;
  today: string;
  pending: boolean;
  runAction: EggRunAction;
}

/** 시작 전이면 예약 취소, 시작 후면 반납 처리. 되돌리기 어려워서 한 번 더 묻는다. */
export function EggRentalActionButton({ rental, deviceLabel, today, pending, runAction }: EggRentalActionButtonProps) {
  if (rental.returned) return <span className="egg-muted-text">-</span>;

  const summary = `${deviceLabel} · ${formatRange(rental.startDate, rental.returnDueDate)} · ${rental.borrowerName}`;

  if (rental.startDate > today) {
    return (
      <button
        type="button"
        className="assign-cancel-btn"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`이 예약을 취소할까요?\n${summary}`)) return;
          void runAction(() => callEggApi(`/api/eggs/rentals/${rental.id}`, "DELETE"), "예약을 취소했습니다.");
        }}
      >
        예약 취소
      </button>
    );
  }

  return <EggReturnButton summary={summary} pending={pending} onConfirm={() =>
    void runAction(() => callEggApi(`/api/eggs/rentals/${rental.id}`, "PATCH"), "반납 처리했습니다.")
  } />;
}

/**
 * 반납 처리 버튼 + 반납 장소 확인 창.
 * 실물이 제자리에 돌아왔는지 한 번 더 확인받는다. 서버는 같은 에그의 이전 미반납 대여도 함께 닫는다.
 */
function EggReturnButton({ summary, pending, onConfirm }: { summary: string; pending: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="assign-save-btn" disabled={pending} onClick={() => setOpen(true)}>
        반납 처리
      </button>
      {open ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={() => setOpen(false)} />
          <section aria-labelledby="egg-return-title" className="drive-scan-progress-dialog egg-return-dialog">
            <div className="egg-return-body">
              <strong id="egg-return-title">지정된 장소에 반납하셨나요?</strong>
              <p>{summary}</p>
              <p>같은 에그에 이보다 먼저 빌린 미반납 건이 있으면 함께 반납 처리됩니다.</p>
              <div className="egg-return-actions">
                <button type="button" className="assign-cancel-btn" onClick={() => setOpen(false)}>
                  취소
                </button>
                <button
                  type="button"
                  className="assign-save-btn"
                  disabled={pending}
                  onClick={() => {
                    setOpen(false);
                    onConfirm();
                  }}
                >
                  완료
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
