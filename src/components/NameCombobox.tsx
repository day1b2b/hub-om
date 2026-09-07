"use client";

import { useEffect, useRef, useState } from "react";
import { nameComboboxSegments } from "./nameComboboxRules";

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
  unmatchedHint,
  multiple = false
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  unmatchedHint?: string;
  /** true면 "이름1, 이름2"처럼 콤마로 여러 명을 이어서 고를 수 있다(실습코치 등 복수 배정 필드용). */
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useCloseOnOutsideClick(open, () => setOpen(false));

  // multiple일 때는 마지막 콤마 이전 이름들은 이미 선택 완료된 것으로 보고, 마지막 조각만 검색어로 쓴다.
  const segments = nameComboboxSegments(value, multiple);
  const committedNames = multiple ? segments.slice(0, -1).map((s) => s.trim()).filter(Boolean) : [];
  const q = segments[segments.length - 1].trim().toLowerCase();
  const matches = options.filter((o) => {
    if (committedNames.some((name) => name.toLowerCase() === o.toLowerCase())) return false;
    return q ? o.toLowerCase().includes(q) : true;
  });

  const allNames = segments
    .map((s) => s.trim())
    .filter(Boolean);
  const isUnmatched =
    unmatchedHint !== undefined &&
    allNames.length > 0 &&
    allNames.some((name) => !options.some((o) => o.toLowerCase() === name.toLowerCase()));

  function selectOption(option: string) {
    if (multiple) {
      onChange([...committedNames, option].join(", ") + ", ");
      return;
    }
    onChange(option);
    setOpen(false);
  }

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
              onMouseDown={(e) => { e.preventDefault(); selectOption(option); }}
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
