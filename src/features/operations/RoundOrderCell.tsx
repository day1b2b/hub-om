"use client";

import Link from "next/link";
import type { DragEvent } from "react";
import { useRoundReorder } from "./RoundReorderProvider";

// 회차 표의 첫 칸. 회차 링크 + 끌기 손잡이를 담고, 이 칸 전체가 놓는 자리가 된다.
//
// 손잡이를 따로 둔 이유: 같은 행에 수정 입력칸이 여럿 있어서 행 전체를 draggable로 만들면
// 글자 선택·클릭과 부딪힌다. 손잡이만 끌 수 있게 하고, 놓는 자리는 칸 전체로 넓게 잡는다.
// 칸의 위쪽 절반에 놓으면 그 회차 앞, 아래쪽 절반이면 뒤로 들어간다.

const DRAG_MIME = "application/x-hub-om-round";

interface RoundOrderCellProps {
  href: string;
  label: string;
  operationId: string;
  /** 회차가 하나뿐이면 순서를 바꿀 것이 없다. */
  reorderable: boolean;
}

export function RoundOrderCell({ href, label, operationId, reorderable }: RoundOrderCellProps) {
  const reorder = useRoundReorder();
  const canReorder = reorderable && reorder !== null && !reorder.isBusy;
  const isDragging = reorder?.draggingOperationId === operationId;
  const indicator = reorder?.dropIndicator?.operationId === operationId ? reorder.dropIndicator.position : null;

  const className = [
    "round-order-cell",
    isDragging ? "is-dragging" : "",
    indicator === "before" ? "is-drop-before" : "",
    indicator === "after" ? "is-drop-after" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <td className={className} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
      <div className="round-order-cell-inner">
        {canReorder ? (
          <span
            aria-label={`${label} 순서 바꾸기 — 끌어서 원하는 자리에 놓으세요`}
            className="round-drag-handle"
            draggable
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
            title="끌어서 회차 순서를 바꿉니다"
          >
            ⠿
          </span>
        ) : null}
        <Link className="session-link" href={href}>
          {label}
        </Link>
      </div>
    </td>
  );

  function handleDragStart(event: DragEvent<HTMLSpanElement>) {
    if (!reorder) return;

    // 자체 MIME을 쓴다. 바깥에서 끌어온 파일·텍스트를 회차 이동으로 오해하지 않게 한다.
    event.dataTransfer.setData(DRAG_MIME, operationId);
    event.dataTransfer.effectAllowed = "move";
    reorder.startDrag(operationId);
  }

  function handleDragEnd() {
    reorder?.endDrag();
  }

  function isRoundDrag(event: DragEvent<HTMLTableCellElement>) {
    // dragover에서는 값을 읽을 수 없고 타입만 볼 수 있다(브라우저 보안 규칙).
    return event.dataTransfer.types.includes(DRAG_MIME);
  }

  function positionFor(event: DragEvent<HTMLTableCellElement>): "after" | "before" {
    const bounds = event.currentTarget.getBoundingClientRect();

    return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
  }

  function handleDragOver(event: DragEvent<HTMLTableCellElement>) {
    if (!reorder || reorder.isBusy || !isRoundDrag(event)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    reorder.setDropIndicator({ operationId, position: positionFor(event) });
  }

  function handleDragLeave() {
    if (reorder?.dropIndicator?.operationId === operationId) reorder.setDropIndicator(null);
  }

  function handleDrop(event: DragEvent<HTMLTableCellElement>) {
    if (!reorder || reorder.isBusy || !isRoundDrag(event)) return;

    event.preventDefault();

    const draggedOperationId = event.dataTransfer.getData(DRAG_MIME);
    if (!draggedOperationId) return;

    reorder.requestMove(draggedOperationId, reorder.targetIndexFor(operationId, positionFor(event)));
  }
}
