"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface Position {
  left: number;
  maxHeight: number;
  top: number;
}

interface SessionFieldPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  onClose: () => void;
}

/**
 * 회차 테이블 셀 바로 아래에 붙는 작은 편집 패널. document.body에 portal로 그린다 -
 * 회차 테이블(.session-table-wrap)이 overflow-x: auto라, 셀 안에 그대로 두면 아래로
 * 펼쳐지는 내용이 잘려 보이지 않기 때문이다(SearchableSelect 드롭다운과 같은 이유).
 * top을 뷰포트 아래쪽에 닿지 않게 고정하고 maxHeight를 함께 넘겨, 내용(달력 등)이
 * 길어도 패널 자체가 스크롤되어 저장/취소 버튼까지 항상 닿을 수 있게 한다.
 */
export function SessionFieldPopover({ anchorRef, children, onClose }: SessionFieldPopoverProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function updatePosition() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const minHeight = 280;
      const maxTop = Math.max(margin, window.innerHeight - margin - minHeight);
      const top = Math.min(rect.bottom + 4, maxTop);
      setPosition({ left: rect.left, maxHeight: window.innerHeight - top - margin, top });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [anchorRef]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose]);

  if (!position) return null;

  return createPortal(
    <div
      className="session-field-popover"
      ref={panelRef}
      style={{ left: position.left, maxHeight: position.maxHeight, top: position.top }}
    >
      {children}
    </div>,
    document.body
  );
}
