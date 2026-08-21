"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  blankLectureNoteTab,
  composeLectureNote,
  containsLectureNoteMarkers,
  ISSUE_TAG_OPTIONS,
  parseLectureNote,
  parseLectureNoteBody,
  type LectureNoteTab
} from "@/lib/data/lectureNote";
import { isNavigableHref, toHref } from "@/lib/links";

type SaveState = "idle" | "saving" | "failed";
type NoteMode = "text" | "link";

interface LectureManagementNoteRowProps {
  done: boolean;
  operationId: string;
  startDate: string;
  value: string;
}

export function LectureManagementNoteRow({
  done,
  operationId,
  startDate,
  value
}: LectureManagementNoteRowProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [tabs, setTabs] = useState<LectureNoteTab[]>(() => parseLectureNote(value, startDate));
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [mode, setMode] = useState<NoteMode>(() => (isNavigableHref(value) ? "link" : "text"));
  const [linkDraft, setLinkDraft] = useState(() => (isNavigableHref(value) ? value : ""));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const activeTab = tabs[activeTabIndex] ?? blankLectureNoteTab();
  const hasHref = isNavigableHref(value);

  return (
    <div className={`archive-item-row ${done ? "done" : "missing"}`}>
      <div className="archive-item-actions">
        {hasHref ? (
          <a aria-label="등록 정보 확인" className="table-link-icon" href={toHref(value) ?? value} rel="noreferrer" target="_blank">
            ↗
          </a>
        ) : null}
        <button className="archive-item-edit-trigger" onClick={openDialog} type="button">
          {done ? "확인" : "등록"}
        </button>
      </div>

      {isOpen ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={closeDialog} />
          <section aria-labelledby="lecture-management-note-title" className="drive-review-dialog lecture-note-dialog">
            <div className="drive-review-header">
              <div>
                <h2 id="lecture-management-note-title">강의관리</h2>
                <p>강의가 어떻게 진행되었는지 기록합니다.</p>
              </div>
              <button aria-label="강의관리 닫기" onClick={closeDialog} type="button">
                닫기
              </button>
            </div>

            <div className="lecture-note-tabbar">
              <div className="lecture-note-tabs">
                <button className={`lecture-note-tab ${mode === "text" ? "active" : ""}`} onClick={() => setMode("text")} type="button">
                  텍스트로 기록
                </button>
                <button className={`lecture-note-tab ${mode === "link" ? "active" : ""}`} onClick={() => setMode("link")} type="button">
                  링크로 등록
                </button>
              </div>

              {mode === "text" ? (
                <div className="lecture-note-tabs">
                  {tabs.map((tab, index) => (
                    <button
                      className={`lecture-note-tab ${index === activeTabIndex ? "active" : ""}`}
                      key={index}
                      onClick={() => setActiveTabIndex(index)}
                      type="button"
                    >
                      {tab.date.trim() || `날짜 ${index + 1}`}
                    </button>
                  ))}
                  <button className="lecture-note-tab-add" onClick={addTab} type="button">
                    + 날짜 추가
                  </button>
                </div>
              ) : null}
            </div>

            {mode === "text" ? (
              <div className="lecture-note-body">
                <div className="lecture-note-tab-header">
                  <label className="lecture-note-field">
                    <span>교육 날짜</span>
                    <input
                      onChange={(event) => updateActiveTab({ date: event.target.value })}
                      type="date"
                      value={activeTab.date}
                    />
                  </label>
                  {tabs.length > 1 ? (
                    <button className="lecture-note-tab-remove" onClick={removeActiveTab} type="button">
                      이 날짜 삭제
                    </button>
                  ) : null}
                </div>

                <label className="lecture-note-field">
                  <span>학습 인원</span>
                  <input
                    onChange={(event) => updateActiveTab({ studentCount: event.target.value })}
                    onPaste={handleSmartPaste}
                    placeholder="예: 27명"
                    type="text"
                    value={activeTab.studentCount}
                  />
                </label>

                <label className="lecture-note-field lecture-note-field-block">
                  <span>강의 요약</span>
                  <textarea
                    className="lecture-note-textarea"
                    onChange={(event) => updateActiveTab({ courseSummary: event.target.value })}
                    onPaste={handleSmartPaste}
                    placeholder="시간대별 강의 진행 내용을 기록하세요."
                    value={activeTab.courseSummary}
                  />
                </label>

                <label className="lecture-note-field lecture-note-field-block">
                  <span>운영진 의견</span>
                  <textarea
                    className="lecture-note-textarea"
                    onChange={(event) => updateActiveTab({ staffOpinion: event.target.value })}
                    onPaste={handleSmartPaste}
                    placeholder="강사/학습자/교육환경/교담자 관련 의견을 기록하세요."
                    value={activeTab.staffOpinion}
                  />
                </label>

                <div className="lecture-note-field lecture-note-field-block">
                  <span>이슈 유형</span>
                  <div aria-label="이슈 유형 선택" className="lecture-note-issue-tags" role="group">
                    {ISSUE_TAG_OPTIONS.map((tag) => (
                      <button
                        aria-pressed={activeTab.issueTags.includes(tag)}
                        className={`lecture-note-tag-toggle ${activeTab.issueTags.includes(tag) ? "active" : ""}`}
                        key={tag}
                        onClick={() => toggleIssueTag(tag)}
                        type="button"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="lecture-note-field lecture-note-field-block">
                  <span>이슈 상세</span>
                  <textarea
                    className="lecture-note-textarea"
                    onChange={(event) => updateActiveTab({ issue: event.target.value })}
                    onPaste={handleSmartPaste}
                    placeholder="발생한 이슈와 대응 내용을 기록하세요."
                    value={activeTab.issue}
                  />
                </label>
              </div>
            ) : (
              <div className="lecture-note-body">
                <label className="lecture-note-field lecture-note-field-block">
                  <span>강의관리 링크</span>
                  <input
                    onChange={(event) => setLinkDraft(event.target.value)}
                    placeholder="https://..."
                    type="url"
                    value={linkDraft}
                  />
                </label>
              </div>
            )}

            <div className="lecture-note-footer">
              {saveState === "failed" ? <span className="lecture-note-save-error">저장하지 못했습니다.</span> : null}
              <div className="lecture-note-actions">
                <button disabled={saveState === "saving"} onClick={closeDialog} type="button">
                  취소
                </button>
                <button disabled={saveState === "saving"} onClick={save} type="button">
                  {saveState === "saving" ? "저장 중" : "저장"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );

  function openDialog() {
    setTabs(parseLectureNote(value, startDate));
    setActiveTabIndex(0);
    setMode(isNavigableHref(value) ? "link" : "text");
    setLinkDraft(isNavigableHref(value) ? value : "");
    setSaveState("idle");
    setIsOpen(true);
  }

  function closeDialog() {
    setTabs(parseLectureNote(value, startDate));
    setActiveTabIndex(0);
    setMode(isNavigableHref(value) ? "link" : "text");
    setLinkDraft(isNavigableHref(value) ? value : "");
    setSaveState("idle");
    setIsOpen(false);
  }

  function addTab() {
    const newIndex = tabs.length;
    setTabs((current) => [...current, blankLectureNoteTab()]);
    setActiveTabIndex(newIndex);
  }

  function removeActiveTab() {
    if (tabs.length <= 1) return;

    const removedIndex = activeTabIndex;
    setTabs((current) => current.filter((_, index) => index !== removedIndex));
    setActiveTabIndex((current) => Math.max(0, removedIndex <= current ? current - 1 : current));
  }

  function updateActiveTab(patch: Partial<LectureNoteTab>) {
    setTabs((current) => current.map((tab, index) => (index === activeTabIndex ? { ...tab, ...patch } : tab)));
  }

  function toggleIssueTag(tag: string) {
    setTabs((current) =>
      current.map((tab, index) =>
        index === activeTabIndex
          ? { ...tab, issueTags: tab.issueTags.includes(tag) ? tab.issueTags.filter((item) => item !== tag) : [...tab.issueTags, tag] }
          : tab
      )
    );
  }

  function handleSmartPaste(event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData("text");
    if (!containsLectureNoteMarkers(pasted)) return;

    event.preventDefault();
    const parsed = parseLectureNoteBody(pasted);
    updateActiveTab({
      courseSummary: parsed.courseSummary || activeTab.courseSummary,
      issue: parsed.issue || activeTab.issue,
      issueTags: parsed.issueTags.length > 0 ? parsed.issueTags : activeTab.issueTags,
      staffOpinion: parsed.staffOpinion || activeTab.staffOpinion,
      studentCount: parsed.studentCount || activeTab.studentCount
    });
  }

  async function save() {
    setSaveState("saving");

    const tabsWithDates = tabs.map((tab) => ({ ...tab, date: tab.date.trim() || startDate }));
    const noteValue = mode === "link" ? linkDraft.trim() : composeLectureNote(tabsWithDates);
    const patches = [{ field: "lectureManagementNote", action: "replace" as const, value: noteValue }];

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ patches })
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

    setIsOpen(false);
    setSaveState("idle");
    router.refresh();
  }
}
