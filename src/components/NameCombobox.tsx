"use client";

import { useEffect, useRef, useState } from "react";

// 이름 목록에서 고르되 자유 입력도 허용하는 콤보박스. om-request의 기업명 콤보박스와 동일한 패턴.
// 목록에 없는 값도 그대로 저장되지만(신규 강사 등 아직 동기화 전일 수 있음), 있으면 hint로 알려준다.
function useCloseOnOutsideClick(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);
  return ref;
}

export function NameCombobox({
  value,
  options,
  onChange,
  placeholder,
  unmatchedHint
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  unmatchedHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useCloseOnOutsideClick(open, () => setOpen(false));

  const q = value.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const isUnmatched = unmatchedHint !== undefined && q !== "" && !options.some((o) => o.toLowerCase() === q);

  return (
    <div className="name-combobox" ref={containerRef}>
      <input
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      {open && matches.length > 0 && (
        <div className="name-combobox-dropdown">
          {matches.slice(0, 20).map((option) => (
            <button
              className="name-combobox-dropdown-option"
              key={option}
              onMouseDown={(e) => { e.preventDefault(); onChange(option); setOpen(false); }}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {isUnmatched && <p className="name-combobox-hint">{unmatchedHint}</p>}
    </div>
  );
}
