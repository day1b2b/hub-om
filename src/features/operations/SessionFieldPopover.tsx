"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface Position {
  left: number;
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
 */
export function SessionFieldPopover({ anchorRef, children, onClose }: SessionFieldPopoverProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function updatePosition() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ left: rect.left, top: rect.bottom + 4 });
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
    <div className="session-field-popover" ref={panelRef} style={{ left: position.left, top: position.top }}>
      {children}
    </div>,
    document.body
  );
}
