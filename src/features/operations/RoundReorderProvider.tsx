"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { moveRoundInOrder, planRoundReorder, type RoundReorderChange } from "@/lib/data/roundReorder";

// 회차 표의 드래그 순서 바꾸기 상태를 한 곳에 둔다.
//
// 놓는 즉시 저장하지 않고 **무엇이 어떻게 바뀌는지 먼저 보여준다.** 순서를 바꾸면 번호가
// 1..N으로 다시 매겨져 여러 회차가 함께 움직이고, 그 번호는 구글 캘린더 일정 제목·결과보고서
// 묶음에도 쓰인다. 한 번의 실수가 여러 곳에 번지므로 사람이 확인한 뒤 쓴다.

export interface RoundReorderItem {
  label: string;
  operationId: string;
  roundNo: string;
}

interface RoundReorderContextValue {
  draggingOperationId: null | string;
  dropIndicator: null | { operationId: string; position: "after" | "before" };
  endDrag: () => void;
  isBusy: boolean;
  requestMove: (operationId: string, toIndex: number) => void;
  setDropIndicator: (value: null | { operationId: string; position: "after" | "before" }) => void;
  startDrag: (operationId: string) => void;
  targetIndexFor: (operationId: string, position: "after" | "before") => number;
}

const RoundReorderContext = createContext<null | RoundReorderContextValue>(null);

export function useRoundReorder() {
  return useContext(RoundReorderContext);
}

interface RoundReorderProviderProps {
  baseOperationId: string;
  children: ReactNode;
  rounds: RoundReorderItem[];
}

export function RoundReorderProvider({ baseOperationId, children, rounds }: RoundReorderProviderProps) {
  const router = useRouter();
  const [draggingOperationId, setDraggingOperationId] = useState<null | string>(null);
  const [dropIndicator, setDropIndicator] = useState<null | { operationId: string; position: "after" | "before" }>(null);
  const [pending, setPending] = useState<null | { changes: RoundReorderChange[]; orderedOperationIds: string[] }>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<null | string>(null);

  const orderedOperationIds = useMemo(() => rounds.map((round) => round.operationId), [rounds]);
  const labelByOperationId = useMemo(
    () => new Map(rounds.map((round) => [round.operationId, round.label])),
    [rounds]
  );

  const value: RoundReorderContextValue = {
    draggingOperationId,
    dropIndicator,
    endDrag: () => {
      setDraggingOperationId(null);
      setDropIndicator(null);
    },
    isBusy,
    requestMove,
    setDropIndicator,
    startDrag: (operationId: string) => {
      setError(null);
      setDraggingOperationId(operationId);
    },
    targetIndexFor
  };

  return (
    <RoundReorderContext.Provider value={value}>
      {children}
      {pending ? renderConfirm(pending) : null}
    </RoundReorderContext.Provider>
  );

  /** "이 회차 앞/뒤"를 목록 인덱스로 바꾼다. */
  function targetIndexFor(operationId: string, position: "after" | "before"): number {
    const index = orderedOperationIds.indexOf(operationId);
    if (index < 0) return orderedOperationIds.length;

    return position === "before" ? index : index + 1;
  }

  function requestMove(operationId: string, toIndex: number) {
    setDraggingOperationId(null);
    setDropIndicator(null);

    const nextOrder = moveRoundInOrder(orderedOperationIds, operationId, toIndex);
    // 화면에서 쓰는 것과 서버가 쓰는 것이 같은 함수다. 미리보기와 실제 결과가 갈라지지 않는다.
    const plan = planRoundReorder(
      rounds.map((round) => ({ operationId: round.operationId, roundNo: round.roundNo })),
      nextOrder
    );

    if (!plan.ok) {
      setError(plan.error);
      return;
    }

    if (plan.changes.length === 0) return; // 제자리에 놓았다.

    setPending({ changes: plan.changes, orderedOperationIds: nextOrder });
  }

  function renderConfirm(current: { changes: RoundReorderChange[]; orderedOperationIds: string[] }) {
    if (typeof document === "undefined") return null;

    return createPortal(
      <div aria-modal="true" className="drive-review-modal" role="dialog">
        <div className="drive-review-backdrop" onClick={isBusy ? undefined : closeConfirm} />
        <section aria-labelledby="round-reorder-title" className="drive-review-dialog round-reorder-dialog">
          <div className="drive-review-header">
            <div>
              <h2 id="round-reorder-title">회차 순서 바꾸기</h2>
              <p>회차 번호가 아래처럼 다시 매겨집니다. 일정·강사·만족도는 각 회차에 그대로 붙어 함께 움직입니다.</p>
            </div>
            <button aria-label="닫기" disabled={isBusy} onClick={closeConfirm} type="button">
              닫기
            </button>
          </div>

          <ul className="round-reorder-changes">
            {current.changes.map((change) => (
              <li key={change.operationId}>
                <strong>{labelByOperationId.get(change.operationId) ?? `${change.fromRoundNo}회차`}</strong>
                <span aria-hidden="true"> → </span>
                <span>{change.toRoundNo}회차</span>
              </li>
            ))}
          </ul>

          <p className="round-reorder-note">
            바뀐 번호는 구글 캘린더 일정 제목에도 반영됩니다. 참석자에게 메일은 가지 않습니다.
          </p>

          {error ? <p className="round-reorder-error">{error}</p> : null}

          <div className="drive-review-footer">
            <button disabled={isBusy} onClick={closeConfirm} type="button">
              취소
            </button>
            <button disabled={isBusy} onClick={() => apply(current.orderedOperationIds)} type="button">
              {isBusy ? "바꾸는 중" : "순서 바꾸기"}
            </button>
          </div>
        </section>
      </div>,
      document.body
    );
  }

  function closeConfirm() {
    setPending(null);
    setError(null);
  }

  async function apply(nextOrder: string[]) {
    setIsBusy(true);
    setError(null);

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(baseOperationId)}/rounds/reorder`, {
        body: JSON.stringify({ orderedOperationIds: nextOrder }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
    } catch {
      setIsBusy(false);
      setError("회차 순서를 바꾸지 못했습니다. 잠시 뒤 다시 시도해주세요.");
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean };

    if (!response.ok || !payload.ok) {
      setIsBusy(false);
      setError(payload.error ?? "회차 순서를 바꾸지 못했습니다.");
      return;
    }

    setIsBusy(false);
    setPending(null);
    router.refresh();
  }
}
