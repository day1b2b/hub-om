"use client";

import Link from "next/link";
import { useState } from "react";
import { NO_CATEGORY_LABEL, type InstructorCategoryGroup } from "./instructorWikiModel";

interface InstructorCategoryTreeProps {
  groups: InstructorCategoryGroup[];
  totalCount: number;
  /** 선택된 카테고리. null이면 전체. */
  selected: string | null;
  onSelect: (category: string | null) => void;
}

/**
 * 카테고리 트리(조직도 형태). 카테고리를 펼치면 소속 강사가 보이고,
 * 카테고리를 누르면 오른쪽 목록이 그 카테고리로 좁혀진다.
 *
 * 펼침 상태는 이 컴포넌트 안에서만 관리한다(어떤 카테고리를 열어뒀는지는 필터가 아니므로).
 */
export function InstructorCategoryTree({ groups, totalCount, selected, onSelect }: InstructorCategoryTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (label: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <aside className="category-tree">
      <div className="category-tree-head">카테고리</div>

      <button
        className={selected === null ? "tree-node tree-node--root is-selected" : "tree-node tree-node--root"}
        onClick={() => onSelect(null)}
        type="button"
      >
        <span className="tree-caret" aria-hidden="true">▾</span>
        <span className="tree-label">전체</span>
        <span className="tree-count">{totalCount}</span>
      </button>

      {groups.length === 0 ? (
        <p className="tree-empty">표시할 카테고리가 없습니다.</p>
      ) : (
        <ul className="tree-list">
          {groups.map((group) => {
            const isOpen = expanded.has(group.label);
            const isSelected = selected === group.label;
            return (
              <li key={group.label}>
                <div className={isSelected ? "tree-row is-selected" : "tree-row"}>
                  <button
                    aria-expanded={isOpen}
                    aria-label={`${group.label} 강사 목록 ${isOpen ? "접기" : "펼치기"}`}
                    className="tree-caret-btn"
                    onClick={() => toggle(group.label)}
                    type="button"
                  >
                    <span className="tree-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                  </button>
                  <button className="tree-node" onClick={() => onSelect(group.label)} type="button">
                    <span className="tree-label">
                      {group.label === NO_CATEGORY_LABEL ? "카테고리 미지정" : group.label}
                    </span>
                    <span className="tree-count">{group.entries.length}</span>
                  </button>
                </div>

                {isOpen ? (
                  <ul className="tree-children">
                    {group.entries.map((entry) => (
                      <li key={entry.id}>
                        <Link className="tree-leaf" href={`/instructor-wiki/${encodeURIComponent(entry.name)}`}>
                          {entry.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
