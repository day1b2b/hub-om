"use client";

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

  return (
    <button
      type="button"
      className="assign-save-btn"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`반납 처리할까요?\n${summary}`)) return;
        void runAction(() => callEggApi(`/api/eggs/rentals/${rental.id}`, "PATCH"), "반납 처리했습니다.");
      }}
    >
      반납 처리
    </button>
  );
}
