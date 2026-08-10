"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface SearchableSelectProps {
  ariaLabel?: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  value: string;
}

interface DropdownPosition {
  left: number;
  top: number;
  width: number;
}

/**
 * 옵션 목록이 길어질 수 있는 select를 검색으로 좁혀 고를 수 있게 한 콤보박스.
 * 드롭다운은 document.body에 portal로 그린다. 필터 바가 overflow-x: auto라
 * 자식 위치 그대로 두면 아래로 펼쳐지는 목록이 잘려 보이지 않기 때문이다.
 */
export function SearchableSelect({ ariaLabel, onChange, options, placeholder, value }: SearchableSelectProps) {
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [syncedValue, setSyncedValue] = useState(value);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);

  if (value !== syncedValue) {
    setSyncedValue(value);
    setQuery(value);
  }

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setIsOpen(false);
      setQuery(value);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;

    function updatePosition() {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ left: rect.left, top: rect.bottom, width: rect.width });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword || keyword === value.toLowerCase()) return options;
    return options.filter((option) => option.toLowerCase().includes(keyword));
  }, [options, query, value]);

  function selectOption(option: string) {
    onChange(option);
    setQuery(option);
    setIsOpen(false);
  }

  return (
    <div className="searchable-select" ref={containerRef}>
      <input
        aria-label={ariaLabel}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        ref={inputRef}
        type="text"
        value={query}
      />
      {isOpen && position
        ? createPortal(
            <ul
              className="searchable-select-options"
              ref={dropdownRef}
              role="listbox"
              style={{ left: position.left, top: position.top, width: Math.max(position.width, 220) }}
            >
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                  <li key={option}>
                    <button
                      aria-selected={option === value}
                      onClick={() => selectOption(option)}
                      role="option"
                      type="button"
                    >
                      {option}
                    </button>
                  </li>
                ))
              ) : (
                <li className="searchable-select-empty">검색 결과 없음</li>
              )}
            </ul>,
            document.body
          )
        : null}
    </div>
  );
}
