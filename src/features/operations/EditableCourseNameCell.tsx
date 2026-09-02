"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type SaveState = "idle" | "saving" | "failed";

interface EditableCourseNameCellProps {
  courseName: string;
  href: string;
  operationIds: string[];
}

/**
 * 운영현황 표의 "과정명" 셀. 같은 과정(회사+코스ID+과정명)에 속한 회차 전체(operationIds)에
 * 과정명 변경을 한 번에 반영한다 — 회차별로 과정명이 갈라지면 표의 과정 묶음 자체가 깨진다.
 */
export function EditableCourseNameCell({ courseName, href, operationIds }: EditableCourseNameCellProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(courseName);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  if (!isEditing) {
    return (
      <td className="course-name-cell">
        <div className="course-name-cell-view">
          <Link className="course-link" href={href}>
            <strong>{courseName}</strong>
          </Link>
          <button className="round-resource-edit-trigger" onClick={startEditing} type="button">
            수정
          </button>
        </div>
      </td>
    );
  }

  return (
    <td className="course-name-cell editing">
      <div className="course-name-cell-edit-form">
        <input
          aria-label="과정명"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") cancelEditing();
          }}
          type="text"
          value={draft}
        />
        <div className="round-resource-cell-edit-actions">
          <button disabled={saveState === "saving"} onClick={save} type="button">
            {saveState === "saving" ? "저장 중" : "저장"}
          </button>
          <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
            취소
          </button>
        </div>
      </div>
      {saveState === "failed" ? <span className="archive-item-save-error">저장하지 못했습니다.</span> : null}
    </td>
  );

  function startEditing() {
    setDraft(courseName);
    setSaveState("idle");
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(courseName);
    setSaveState("idle");
    setIsEditing(false);
  }

  async function save() {
    const nextValue = draft.trim();

    if (!nextValue) {
      setSaveState("failed");
      return;
    }

    setSaveState("saving");

    const results = await Promise.all(
      operationIds.map((operationId) =>
        fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ patches: [{ field: "courseName", action: "replace", value: nextValue }] })
        })
          .then((response) => response.ok)
          .catch(() => false)
      )
    );

    if (!results.every(Boolean)) {
      setSaveState("failed");
      return;
    }

    setIsEditing(false);
    setSaveState("idle");
    router.refresh();
  }
}
