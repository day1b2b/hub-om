"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { findLinkHref } from "@/lib/links";

type SaveState = "idle" | "saving" | "failed";

interface EditableCourseLectureManagementRowProps {
  courseRecordId: string;
  lectureManagementLink: string;
  lectureManagementNote: string;
}

/**
 * 강의관리 링크/메모를 과정(Course) 레벨로 1개만 등록한다. 회차별 LectureManagementNoteRow와
 * 달리 courseRecordId를 받아 `/api/courses/[courseRecordId]/lecture-management`에 두 필드를
 * 항상 함께 저장한다(부분 수정 없음).
 */
export function EditableCourseLectureManagementRow({
  courseRecordId,
  lectureManagementLink,
  lectureManagementNote
}: EditableCourseLectureManagementRowProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [linkDraft, setLinkDraft] = useState(lectureManagementLink);
  const [noteDraft, setNoteDraft] = useState(lectureManagementNote);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const done = Boolean(lectureManagementLink.trim() || lectureManagementNote.trim());
  const href = findLinkHref(lectureManagementLink, lectureManagementNote);

  if (!isEditing) {
    return (
      <div className={`archive-item-row ${done ? "done" : "missing"}`}>
        <strong>강의관리</strong>
        <div className="archive-item-actions">
          {href ? (
            <a className="archive-item-state" href={href} rel="noreferrer" target="_blank">
              열기
            </a>
          ) : (
            <span className="archive-item-state">{done ? "등록됨" : "링크 없음"}</span>
          )}
          <button className="archive-item-edit-trigger" onClick={startEditing} type="button">
            {done ? "수정" : "등록"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="archive-item-row editing">
      <strong>강의관리</strong>
      <div className="archive-item-edit-form lecture-note-body">
        <label className="lecture-note-field lecture-note-field-block">
          <span>강의관리 링크</span>
          <input
            onChange={(event) => setLinkDraft(event.target.value)}
            placeholder="https://"
            type="text"
            value={linkDraft}
          />
        </label>
        <label className="lecture-note-field lecture-note-field-block">
          <span>강의관리 메모</span>
          <textarea
            className="lecture-note-textarea"
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="과정 전체에 공통으로 적용할 강의관리 메모"
            value={noteDraft}
          />
        </label>
        <div className="lecture-note-actions">
          <button disabled={saveState === "saving"} onClick={save} type="button">
            {saveState === "saving" ? "저장 중" : "저장"}
          </button>
          <button disabled={saveState === "saving"} onClick={cancelEditing} type="button">
            취소
          </button>
        </div>
      </div>
      {saveState === "failed" ? <span className="archive-item-save-error">저장하지 못했습니다.</span> : null}
    </div>
  );

  function startEditing() {
    setLinkDraft(lectureManagementLink);
    setNoteDraft(lectureManagementNote);
    setSaveState("idle");
    setIsEditing(true);
  }

  function cancelEditing() {
    setLinkDraft(lectureManagementLink);
    setNoteDraft(lectureManagementNote);
    setSaveState("idle");
    setIsEditing(false);
  }

  async function save() {
    setSaveState("saving");
    const trimmedLink = linkDraft.trim();
    const trimmedNote = noteDraft.trim();

    let response: Response;
    try {
      response = await fetch(`/api/courses/${encodeURIComponent(courseRecordId)}/lecture-management`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lectureManagementLink: trimmedLink, lectureManagementNote: trimmedNote })
      });
    } catch {
      setSaveState("failed");
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean };
    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      return;
    }

    setIsEditing(false);
    setSaveState("idle");
    router.refresh();
  }
}
