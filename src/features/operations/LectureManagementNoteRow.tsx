"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SaveState = "idle" | "saving" | "failed";

interface LectureManagementNoteRowProps {
  done: boolean;
  operationId: string;
  value: string;
}

interface LectureNoteDraft {
  courseSummary: string;
  issue: string;
  staffOpinion: string;
  studentCount: string;
}

interface LectureNoteTab extends LectureNoteDraft {
  date: string;
}

const COURSE_SUMMARY_MARKER = "[강의 요약]";
const STAFF_OPINION_MARKER = "[운영진 의견]";
const ISSUE_MARKER = "[이슈]";
const DATE_HEADER_PATTERN = /^\[날짜:\s*(.*?)\]\s*$/gm;

function blankTab(): LectureNoteTab {
  return { courseSummary: "", date: "", issue: "", staffOpinion: "", studentCount: "" };
}

export function LectureManagementNoteRow({
  done,
  operationId,
  value
}: LectureManagementNoteRowProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [tabs, setTabs] = useState<LectureNoteTab[]>(() => parseLectureNote(value));
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const activeTab = tabs[activeTabIndex] ?? blankTab();
  const hasHref = isNavigableHref(value);

  return (
    <div className={`archive-item-row ${done ? "done" : "missing"}`}>
      <div className="archive-item-actions">
        {hasHref ? (
          <a aria-label="등록 정보 확인" className="table-link-icon" href={value} rel="noreferrer" target="_blank">
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

            <div className="lecture-note-body">
              <div className="lecture-note-tab-header">
                <label className="lecture-note-field">
                  <span>교육 날짜</span>
                  <input
                    onChange={(event) => updateActiveTab({ date: event.target.value })}
                    placeholder="예: 2026-07-01"
                    type="text"
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
                  placeholder="시간대별 강의 진행 내용을 기록하세요."
                  value={activeTab.courseSummary}
                />
              </label>

              <label className="lecture-note-field lecture-note-field-block">
                <span>운영진 의견</span>
                <textarea
                  className="lecture-note-textarea"
                  onChange={(event) => updateActiveTab({ staffOpinion: event.target.value })}
                  placeholder="강사/학습자/교육환경/교담자 관련 의견을 기록하세요."
                  value={activeTab.staffOpinion}
                />
              </label>

              <label className="lecture-note-field lecture-note-field-block">
                <span>이슈</span>
                <textarea
                  className="lecture-note-textarea"
                  onChange={(event) => updateActiveTab({ issue: event.target.value })}
                  placeholder="발생한 이슈와 대응 내용을 기록하세요."
                  value={activeTab.issue}
                />
              </label>
            </div>

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
    setTabs(parseLectureNote(value));
    setActiveTabIndex(0);
    setSaveState("idle");
    setIsOpen(true);
  }

  function closeDialog() {
    setTabs(parseLectureNote(value));
    setActiveTabIndex(0);
    setSaveState("idle");
    setIsOpen(false);
  }

  function addTab() {
    const newIndex = tabs.length;
    setTabs((current) => [...current, blankTab()]);
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

  async function save() {
    setSaveState("saving");

    const patches = [
      { field: "lectureManagementNote", action: "replace" as const, value: composeLectureNote(tabs) }
    ];

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

function parseLectureNote(value: string): LectureNoteTab[] {
  const blocks = splitDateBlocks(value);
  const tabs = blocks.map((block) => ({ date: block.date, ...parseLectureNoteBody(block.body) }));

  return tabs.length > 0 ? tabs : [blankTab()];
}

function splitDateBlocks(value: string): { date: string; body: string }[] {
  const matches = [...value.matchAll(DATE_HEADER_PATTERN)];

  if (matches.length === 0) return [{ body: value, date: "" }];

  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? value.length : value.length;

    return { body: value.slice(start, end).trim(), date: match[1].trim() };
  });
}

function parseLectureNoteBody(value: string): LectureNoteDraft {
  const studentCountMatch = value.match(/학습\s*인원\s*[:：]\s*(.*)/);
  const studentCount = studentCountMatch ? studentCountMatch[1].trim() : "";
  const courseSummary = extractSection(value, COURSE_SUMMARY_MARKER, [STAFF_OPINION_MARKER, ISSUE_MARKER]);
  const staffOpinion = extractSection(value, STAFF_OPINION_MARKER, [ISSUE_MARKER]);
  const issue = extractSection(value, ISSUE_MARKER, []);

  if (!studentCount && !courseSummary && !staffOpinion && !issue && value.trim()) {
    return { courseSummary: value.trim(), issue: "", staffOpinion: "", studentCount: "" };
  }

  return { courseSummary, issue, staffOpinion, studentCount };
}

function extractSection(value: string, marker: string, followingMarkers: string[]): string {
  const startIndex = value.indexOf(marker);
  if (startIndex === -1) return "";

  const afterMarker = value.slice(startIndex + marker.length);
  const endIndex = followingMarkers
    .map((followingMarker) => afterMarker.indexOf(followingMarker))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0];

  return (endIndex === undefined ? afterMarker : afterMarker.slice(0, endIndex)).trim();
}

function composeLectureNote(tabs: LectureNoteTab[]): string {
  const meaningfulTabs = tabs.filter((tab) => hasTabContent(tab));

  if (meaningfulTabs.length === 0) return "";

  if (meaningfulTabs.length === 1 && !meaningfulTabs[0].date.trim()) {
    return composeLectureNoteBody(meaningfulTabs[0]);
  }

  return meaningfulTabs
    .map((tab) => `[날짜: ${tab.date.trim()}]\n${composeLectureNoteBody(tab)}`.trim())
    .join("\n\n");
}

function hasTabContent(tab: LectureNoteTab): boolean {
  return Boolean(tab.date.trim() || tab.courseSummary.trim() || tab.staffOpinion.trim() || tab.issue.trim() || tab.studentCount.trim());
}

function composeLectureNoteBody(draft: LectureNoteDraft): string {
  const sections = [
    draft.studentCount.trim() ? `학습 인원: ${draft.studentCount.trim()}` : "",
    draft.courseSummary.trim() ? `${COURSE_SUMMARY_MARKER}\n${draft.courseSummary.trim()}` : "",
    draft.staffOpinion.trim() ? `${STAFF_OPINION_MARKER}\n${draft.staffOpinion.trim()}` : "",
    draft.issue.trim() ? `${ISSUE_MARKER}\n${draft.issue.trim()}` : ""
  ].filter(Boolean);

  return sections.join("\n\n");
}

function isNavigableHref(value: string) {
  return /^(https?:\/\/|slack:\/\/)/.test(value.trim());
}
