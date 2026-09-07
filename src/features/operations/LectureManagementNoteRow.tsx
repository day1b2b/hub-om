"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isNavigableHref, toHref } from "@/lib/links";
import {
  blankTab,
  composeLectureNote,
  isDateUsedByOtherTab,
  mergePastedNote,
  parseLectureNote,
  prepareTabsForSave,
  shouldSplitPastedNote,
  suggestNextLectureDate,
  type LectureNoteTab
} from "./lectureNoteModel";

type SaveState = "idle" | "saving" | "saved" | "failed";
type NoteMode = "text" | "link";

interface LectureManagementNoteRowProps {
  done: boolean;
  /** 실제 교육일(yyyy-mm-dd) 목록. 새 날짜 탭의 기본 날짜를 고를 때 쓴다. */
  educationDates: string[];
  operationId: string;
  startDate: string;
  value: string;
}

// 2026-08-24에 링크 단일 모드로 잠시 꺼뒀다가 2026-09-03에 텍스트 직접입력 모드를 다시 켰다.
const SHOW_LECTURE_TEXT_MODE = true;
// 입력이 멈춘 뒤 이 시간이 지나면 자동 저장한다.
const AUTOSAVE_DELAY_MS = 3000;
// 저장 실패 후 다시 시도하는 간격. 실패가 반복되면 두 배씩 늘려 서버 복구 직후 요청이 몰리지 않게 한다.
const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_MAX_DELAY_MS = 5 * 60_000;
// 서버 저장이 안 될 때 입력 내용을 잃지 않도록 브라우저에도 같이 보관한다.
const DRAFT_STORAGE_PREFIX = "hub-om:lecture-note-draft:";
// 이보다 오래된 임시 보관본은 열 때 정리한다. 다시 열지 않은 회차의 보관본이 브라우저 저장 공간에 계속 쌓이지 않게 한다.
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredDraft {
  linkDraft: string;
  mode: NoteMode;
  tabs: LectureNoteTab[];
  updatedAt: string;
}

function resolveInitialMode(value: string): NoteMode {
  if (!SHOW_LECTURE_TEXT_MODE) return "link";
  return isNavigableHref(value) ? "link" : "text";
}

export function LectureManagementNoteRow({
  done,
  educationDates,
  operationId,
  startDate,
  value
}: LectureManagementNoteRowProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [tabs, setTabs] = useState<LectureNoteTab[]>(() => parseLectureNote(value, startDate));
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [mode, setMode] = useState<NoteMode>(() => resolveInitialMode(value));
  const [linkDraft, setLinkDraft] = useState(() => (isNavigableHref(value) ? value : ""));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // 사용자가 필드를 직접 고칠 때마다 1씩 올라간다. 모드 탭만 바꾸는 것은 편집으로 치지 않는다.
  const [editVersion, setEditVersion] = useState(0);
  // 마지막으로 필드를 고칠 때의 모드. 저장할 때 이 모드 기준으로 값을 조합한다.
  const [editedMode, setEditedMode] = useState<NoteMode>(mode);
  const [lastSavedValue, setLastSavedValue] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [recoverableDraft, setRecoverableDraft] = useState<StoredDraft | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  // 마지막으로 실패한 저장 요청이 담고 있던 editVersion. 그 뒤로 편집이 없으면 재시도 효과(백오프)에 맡기고
  // 3초 자동 저장은 쉰다. 편집이 있었으면 사용자가 보고 있는 중이니 바로 다시 시도한다.
  const [failedAtEditVersion, setFailedAtEditVersion] = useState<number | null>(null);
  const saveSequenceRef = useRef(0);

  // operationId 외에는 setState와 ref만 쓰므로 참조가 바뀌지 않는다. 효과(effect) 의존성에 그대로 넣을 수 있다.
  const persist = useCallback(
    async (noteValue: string, editVersionAtRequest: number): Promise<boolean> => {
      const sequence = ++saveSequenceRef.current;
      setSaveState("saving");

      const patches = [{ field: "lectureManagementNote", action: "replace" as const, value: noteValue }];
      let ok = false;

      try {
        const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ patches })
        });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean };
        ok = response.ok && Boolean(payload.ok);
      } catch {
        ok = false;
      }

      // 더 최신 저장 요청이 이미 나갔으면 이 결과로 화면 상태를 덮어쓰지 않는다.
      if (sequence !== saveSequenceRef.current) return ok;

      if (!ok) {
        setFailedAtEditVersion(editVersionAtRequest);
        setSaveState("failed");
        setRetryCount((current) => current + 1);
        return false;
      }

      setFailedAtEditVersion(null);
      setLastSavedValue(noteValue);
      setSavedAt(new Date());
      setSaveState("saved");
      setRetryCount(0);
      return true;
    },
    [operationId]
  );

  const activeTab = tabs[activeTabIndex] ?? blankTab();
  const hasHref = isNavigableHref(value);
  const pendingValue = composeCurrentValue(editedMode);
  const hasUnsavedEdit = editVersion > 0 && pendingValue !== lastSavedValue;

  // 저장 요청은 한 번에 하나만 보낸다. 앞 요청이 진행 중일 때 새 요청을 겹쳐 보내면 서버에 옛 값이 나중에
  // 도착해 최신 입력을 덮어쓸 수 있고, 화면은 최신 값이 저장된 줄 알고 임시 보관본까지 지운다.
  // 앞 요청이 끝나면 saveState가 바뀌어 이 효과가 다시 돌고, 그때 남은 변경을 이어서 저장한다.
  useEffect(() => {
    if (!isOpen || !hasUnsavedEdit || saveState === "saving") return;
    // 실패 뒤 편집이 없으면 3초마다 같은 요청을 반복하지 않는다.
    if (saveState === "failed" && failedAtEditVersion === editVersion) return;

    const timer = window.setTimeout(() => {
      void persist(pendingValue, editVersion);
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [isOpen, hasUnsavedEdit, pendingValue, editVersion, saveState, failedAtEditVersion, persist]);

  // 저장에 실패한 동안에만 간격을 늘려 가며 다시 시도한다. 평소에는 아무 요청도 보내지 않는다.
  useEffect(() => {
    if (!isOpen || saveState !== "failed" || !hasUnsavedEdit) return;

    const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1), RETRY_MAX_DELAY_MS);
    const timer = window.setTimeout(() => {
      void persist(pendingValue, editVersion);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [isOpen, saveState, hasUnsavedEdit, pendingValue, editVersion, retryCount, persist]);

  // 편집 중인 내용은 브라우저에도 보관하고, 서버 저장이 끝나면 지운다.
  useEffect(() => {
    if (!isOpen || editVersion === 0) return;

    if (hasUnsavedEdit) {
      writeDraft(operationId, { linkDraft, mode: editedMode, tabs, updatedAt: new Date().toISOString() });
    } else {
      clearDraft(operationId);
    }
  }, [isOpen, editVersion, hasUnsavedEdit, operationId, linkDraft, editedMode, tabs]);

  return (
    <div className={`archive-item-row ${done ? "done" : "missing"}`}>
      <div className="archive-item-actions">
        {hasHref ? (
          <a aria-label="등록 정보 확인" className="table-link-icon" href={toHref(value) ?? value} rel="noreferrer" target="_blank">
            ↗
          </a>
        ) : null}
        <button className="archive-item-edit-trigger" onClick={openDialog} type="button">
          {done ? "수정" : "등록"}
        </button>
      </div>

      {isOpen ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={closeDialog} />
          <section aria-labelledby="lecture-management-note-title" className={`drive-review-dialog lecture-note-dialog ${recoverableDraft ? "has-draft-banner" : ""}`}>
            <div className="drive-review-header">
              <div>
                <h2 id="lecture-management-note-title">강의관리</h2>
                <p>강의가 어떻게 진행되었는지 기록합니다. 입력한 내용은 자동으로 저장됩니다.</p>
              </div>
              <button aria-label="강의관리 닫기" onClick={closeDialog} type="button">
                닫기
              </button>
            </div>

            {recoverableDraft ? (
              <div className="lecture-note-draft-banner" role="status">
                <span>
                  이 브라우저에 저장되지 않은 내용이 있습니다 ({formatClock(new Date(recoverableDraft.updatedAt))} 기준). 복원할까요?
                </span>
                <div className="lecture-note-actions">
                  <button onClick={restoreDraft} type="button">
                    복원
                  </button>
                  <button onClick={discardDraft} type="button">
                    버리기
                  </button>
                </div>
              </div>
            ) : null}

            {SHOW_LECTURE_TEXT_MODE ? (
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
                        onClick={() => {
                          setActiveTabIndex(index);
                          setDateError(null);
                        }}
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
            ) : null}

            {mode === "text" ? (
              <div className="lecture-note-body">
                <div className="lecture-note-tab-header">
                  <label className="lecture-note-field">
                    <span>교육 날짜</span>
                    <input
                      aria-invalid={dateError ? true : undefined}
                      onChange={(event) => changeActiveTabDate(event.target.value)}
                      type="date"
                      value={activeTab.date}
                    />
                    {dateError ? <span className="lecture-note-field-error" role="alert">{dateError}</span> : null}
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

                <label className="lecture-note-field lecture-note-field-block">
                  <span>이슈</span>
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
                    onChange={(event) => updateLinkDraft(event.target.value)}
                    placeholder="https://..."
                    type="url"
                    value={linkDraft}
                  />
                </label>
              </div>
            )}

            <div className="lecture-note-footer">
              <div className="lecture-note-footer-start">
                <span aria-live="polite" className={`lecture-note-save-status ${saveState === "failed" ? "failed" : ""}`}>
                  {renderSaveStatus()}
                </span>
              </div>
              <div className="lecture-note-actions">
                {saveState === "failed" ? (
                  <button onClick={() => void persist(pendingValue, editVersion)} type="button">
                    다시 저장
                  </button>
                ) : null}
                <button disabled={saveState === "saving"} onClick={closeDialog} type="button">
                  닫기
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );

  function openDialog() {
    const initialTabs = parseLectureNote(value, startDate);
    const initialMode = resolveInitialMode(value);
    const initialLink = isNavigableHref(value) ? value : "";

    setTabs(initialTabs);
    setActiveTabIndex(0);
    setMode(initialMode);
    setLinkDraft(initialLink);
    setSaveState("idle");
    setSavedAt(null);
    setDateError(null);
    setEditVersion(0);
    setEditedMode(initialMode);
    setRetryCount(0);
    setFailedAtEditVersion(null);
    // 열자마자 저장이 걸리지 않도록, 현재 값을 화면 형식으로 다시 조합한 결과를 "저장된 값"으로 둔다.
    const initialComposed = initialMode === "link" ? initialLink.trim() : composeLectureNote(withFallbackDates(initialTabs));
    setLastSavedValue(initialComposed);

    // 이전에 서버 저장이 안 된 채 닫힌 내용이 브라우저에 남아 있으면 복원할지 묻는다. 서버 값과 같으면 조용히 지운다.
    pruneStaleDrafts();
    const draft = readDraft(operationId);
    if (draft && composeDraftValue(draft) !== initialComposed) {
      setRecoverableDraft(draft);
    } else {
      if (draft) clearDraft(operationId);
      setRecoverableDraft(null);
    }

    setIsOpen(true);
  }

  function restoreDraft() {
    if (!recoverableDraft) return;

    setTabs(recoverableDraft.tabs.length > 0 ? recoverableDraft.tabs : [blankTab(startDate)]);
    setActiveTabIndex(0);
    setLinkDraft(recoverableDraft.linkDraft);
    setMode(recoverableDraft.mode);
    setEditedMode(recoverableDraft.mode);
    setRecoverableDraft(null);
    // 편집으로 취급해서 자동 저장이 바로 이어지게 한다.
    setEditVersion((current) => current + 1);
  }

  function discardDraft() {
    clearDraft(operationId);
    setRecoverableDraft(null);
  }

  function composeDraftValue(draft: StoredDraft): string {
    return draft.mode === "link" ? draft.linkDraft.trim() : composeLectureNote(withFallbackDates(draft.tabs));
  }

  async function closeDialog() {
    if (saveState === "saving") return;

    if (hasUnsavedEdit) {
      const saved = await persist(pendingValue, editVersion);
      // 저장에 실패하면 입력 내용을 잃지 않도록 창을 닫지 않는다.
      if (!saved) return;
    }

    setIsOpen(false);
    setSaveState("idle");

    if (editVersion > 0) {
      router.refresh();
    }
  }

  function renderSaveStatus() {
    if (saveState === "saving") return "저장 중…";
    if (saveState === "failed") {
      return "서버에 저장하지 못했습니다. 내용은 이 브라우저에 보관되어 있고 잠시 후 자동으로 다시 시도합니다.";
    }
    if (hasUnsavedEdit) return "입력 중… 잠시 후 자동 저장됩니다.";
    if (saveState === "saved" && savedAt) return `자동 저장됨 ${formatClock(savedAt)}`;
    return "";
  }

  function composeCurrentValue(targetMode: NoteMode): string {
    return targetMode === "link" ? linkDraft.trim() : composeLectureNote(withFallbackDates(tabs));
  }

  function withFallbackDates(source: LectureNoteTab[]): LectureNoteTab[] {
    return prepareTabsForSave(source, startDate, educationDates);
  }

  function changeActiveTabDate(nextDate: string) {
    // 날짜를 지우면 저장 때 임의 날짜로 채워지므로, 비우는 조작은 받지 않고 이전 날짜를 유지한다.
    if (!nextDate.trim()) return;

    if (isDateUsedByOtherTab(tabs, activeTabIndex, nextDate)) {
      setDateError("이미 등록된 날짜입니다. 하루에 한 기록만 남길 수 있어요.");
      return;
    }

    setDateError(null);
    updateActiveTab({ date: nextDate });
  }

  function markEdited() {
    setEditedMode(mode);
    setEditVersion((current) => current + 1);
  }

  function addTab() {
    const newIndex = tabs.length;
    const nextDate = suggestNextLectureDate(tabs.map((tab) => tab.date), educationDates, startDate);
    setTabs((current) => [...current, blankTab(nextDate)]);
    setActiveTabIndex(newIndex);
    setDateError(null);
    markEdited();
  }

  function removeActiveTab() {
    if (tabs.length <= 1) return;

    const removedIndex = activeTabIndex;
    setTabs((current) => current.filter((_, index) => index !== removedIndex));
    setActiveTabIndex((current) => Math.max(0, removedIndex <= current ? current - 1 : current));
    setDateError(null);
    markEdited();
  }

  function updateActiveTab(patch: Partial<LectureNoteTab>) {
    setTabs((current) => current.map((tab, index) => (index === activeTabIndex ? { ...tab, ...patch } : tab)));
    markEdited();
  }

  function updateLinkDraft(next: string) {
    setLinkDraft(next);
    markEdited();
  }

  function handleSmartPaste(event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData("text");
    if (!shouldSplitPastedNote(pasted)) return;

    // 날짜 제목이 여러 개면 날짜별 탭으로, 칸 제목만 있으면 지금 탭의 칸으로 나눠 넣는다.
    event.preventDefault();
    setTabs((current) => mergePastedNote(current, activeTabIndex, pasted));
    setDateError(null);
    markEdited();
  }
}

function draftStorageKey(operationId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${operationId}`;
}

function readDraft(operationId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(operationId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (!Array.isArray(parsed.tabs) || typeof parsed.updatedAt !== "string") return null;

    return {
      linkDraft: typeof parsed.linkDraft === "string" ? parsed.linkDraft : "",
      mode: parsed.mode === "link" ? "link" : "text",
      tabs: parsed.tabs.map((tab) => ({ ...blankTab(), ...tab })),
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
}

function writeDraft(operationId: string, draft: StoredDraft) {
  try {
    window.localStorage.setItem(draftStorageKey(operationId), JSON.stringify(draft));
  } catch {
    // 시크릿 모드나 저장 공간 부족이면 보관만 건너뛴다. 서버 저장은 그대로 시도한다.
  }
}

/** 오래된 임시 보관본을 지운다. 열려 있는 회차의 보관본은 이 뒤에 따로 읽으므로 여기서 함께 정리돼도 최신 것은 남는다. */
function pruneStaleDrafts() {
  try {
    const cutoff = Date.now() - DRAFT_MAX_AGE_MS;
    const staleKeys: string[] = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(DRAFT_STORAGE_PREFIX)) continue;

      const raw = window.localStorage.getItem(key);
      const updatedAt = raw ? Date.parse((JSON.parse(raw) as Partial<StoredDraft>).updatedAt ?? "") : Number.NaN;
      // 시각을 읽을 수 없는 보관본은 복원할 수도 없으므로 함께 지운다.
      if (Number.isNaN(updatedAt) || updatedAt < cutoff) staleKeys.push(key);
    }

    for (const key of staleKeys) window.localStorage.removeItem(key);
  } catch {
    // 저장 공간을 읽을 수 없으면 정리를 건너뛴다. 보관본 읽기/쓰기도 같은 이유로 건너뛰므로 동작에는 영향이 없다.
  }
}

function clearDraft(operationId: string) {
  try {
    window.localStorage.removeItem(draftStorageKey(operationId));
  } catch {
    // 지우지 못해도 다음에 열 때 서버 값과 같으면 다시 정리된다.
  }
}

function formatClock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
