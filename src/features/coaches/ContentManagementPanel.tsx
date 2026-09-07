"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

interface FeedEntry {
  id: string;
  kind: "note" | "review" | "history";
  coachId: string;
  coachName: string;
  authorOrSource: string;
  content: string;
  flagged: boolean;
  createdAt: string;
  rating?: number | null;
  feedback?: string | null;
}

interface FeedResponse {
  ok: boolean;
  entries?: FeedEntry[];
  error?: string;
}

type FilterKey = "all" | "note" | "review";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "전체",
  note: "메모",
  review: "리뷰"
};

const KIND_LABEL: Record<FeedEntry["kind"], string> = {
  note: "메모",
  review: "리뷰",
  history: "수정이력"
};

export function ContentManagementPanel({ onChanged }: { onChanged?: () => void }) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [editRating, setEditRating] = useState(0);
  const [editFeedback, setEditFeedback] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  async function mutate(url: string, init: RequestInit) {
    if (saving.current) return false;
    saving.current = true; setBusy(true); setMutationError("");
    try {
      const response = await fetch(url, init);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "변경을 저장하지 못했습니다.");
      onChanged?.();
      return true;
    } catch (reason) { setMutationError(reason instanceof Error ? reason.message : "저장 오류"); return false; }
    finally { saving.current = false; setBusy(false); }
  }

  async function saveNote(entry: FeedEntry) {
    if (!editNote.trim()) { setMutationError("메모 내용을 입력하세요."); return; }
    if (!await mutate(`/api/coaches/${entry.coachId}/notes/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: editNote }) })) return;
    setEditingNoteId(null); await load();
  }

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/content-entries", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({ ok: false }))) as FeedResponse;
      if (!response.ok || !payload.ok || !payload.entries) throw new Error(payload.error ?? "콘텐츠를 불러오지 못했습니다.");
      setEntries(payload.entries);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "조회 오류"); }
    finally { setIsLoading(false); }
  }

  useEffect(() => {
    // Data fetching is the external synchronization this panel needs on mount.
    load();
  }, []);

  const filteredEntries = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.kind === filter)),
    [entries, filter]
  );

  async function handleNoteAction(coachId: string, entryId: string, action: "delete" | "warn") {
    if (action === "delete" && !window.confirm("이 메모를 삭제할까요?")) return;

    if (!await mutate(`/api/coaches/${coachId}/notes/${entryId}`, {
      method: action === "delete" ? "DELETE" : "PATCH",
      headers: action === "warn" ? { "content-type": "application/json" } : undefined,
      body: action === "warn" ? JSON.stringify({ toggleWarn: true }) : undefined
    })) return;
    await load();
  }

  function startEditReview(entry: FeedEntry) {
    setEditingReviewId(entry.id);
    setEditingNoteId(null);
    setEditRating(entry.rating ?? 0);
    setEditFeedback(entry.feedback ?? "");
  }

  async function saveReview(engagementId: string) {
    if (!await mutate(`/api/engagements/${engagementId}/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: editRating || null, feedback: editFeedback })
    })) return;
    setEditingReviewId(null);
    await load();
  }

  async function deleteReview(engagementId: string) {
    if (!window.confirm("이 리뷰(평점·한줄평)를 삭제할까요?")) return;
    if (!await mutate(`/api/engagements/${engagementId}/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deleteReview: true })
    })) return;
    await load();
  }

  async function toggleReviewFlag(engagementId: string) {
    if (!await mutate(`/api/engagements/${engagementId}/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toggleFlag: true })
    })) return;
    await load();
  }

  if (isLoading) return <div className="coach-doc-empty"><span>불러오는 중…</span></div>;
  if (error) return <div className="coach-origin-empty-panel" role="alert">{error}<button onClick={load}>다시 불러오기</button></div>;

  return (
    <div className="coach-content-panel">
      <p>메모·리뷰 각각 최근 300건을 표시합니다. 시각은 한국 시간입니다.</p>
      {mutationError ? <p role="alert">{mutationError}</p> : null}
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <div className="coach-admin-schedule-filters">
        {(Object.keys(FILTER_LABEL) as FilterKey[]).map((key) => (
          <button
            className={filter === key ? "selected" : ""}
            key={key}
            onClick={() => setFilter(key)}
            type="button"
          >
            {FILTER_LABEL[key]}
          </button>
        ))}
      </div>

      {filteredEntries.length === 0 ? (
        <div className="coach-origin-empty-panel">표시할 콘텐츠가 없습니다.</div>
      ) : (
        <ul className="coach-content-feed">
          {filteredEntries.map((entry) => (
            <li className={entry.flagged ? "flagged" : ""} key={`${entry.kind}-${entry.id}`}>
              <div className="coach-content-feed-meta">
                <span className={`coach-content-kind ${entry.kind}`}>{KIND_LABEL[entry.kind]}</span>
                <Link href={`/coaches/${entry.coachId}`}>{entry.coachName}</Link>
                <span className="coach-content-source">{entry.authorOrSource}</span>
                <time>{formatDateTime(entry.createdAt)}</time>
              </div>

              {entry.kind === "note" && editingNoteId === entry.id ? <div className="coach-notes-edit"><textarea aria-label="메모 내용" value={editNote} onChange={e => setEditNote(e.target.value)} rows={4} /><button type="button" onClick={() => saveNote(entry)}>저장</button><button type="button" onClick={() => setEditingNoteId(null)}>취소</button></div> : entry.kind === "review" && editingReviewId === entry.id ? (
                <div className="coach-notes-edit">
                  <div className="coach-review-rating-picker">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        className={value <= editRating ? "selected" : ""}
                        key={value}
                        onClick={() => setEditRating(value)}
                        type="button"
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <textarea
                    aria-label="리뷰 내용"
                    onChange={(event) => setEditFeedback(event.target.value)}
                    rows={2}
                    value={editFeedback}
                  />
                  <div className="coach-notes-actions">
                    <button onClick={() => saveReview(entry.id)} type="button">저장</button>
                    <button onClick={() => setEditingReviewId(null)} type="button">취소</button>
                  </div>
                </div>
              ) : (
                <p>{entry.content}</p>
              )}

              {entry.kind === "note" && editingNoteId !== entry.id ? (
                <div className="coach-notes-actions">
                  <button type="button" onClick={() => { setEditingNoteId(entry.id); setEditNote(entry.content); setEditingReviewId(null); }}>수정</button>
                  <button onClick={() => handleNoteAction(entry.coachId, entry.id, "delete")} type="button">삭제</button>
                  <button onClick={() => handleNoteAction(entry.coachId, entry.id, "warn")} type="button">
                    {entry.flagged ? "경고 해제" : "경고"}
                  </button>
                </div>
              ) : null}

              {entry.kind === "review" && editingReviewId !== entry.id ? (
                <div className="coach-notes-actions">
                  <button onClick={() => startEditReview(entry)} type="button">수정</button>
                  <button onClick={() => deleteReview(entry.id)} type="button">삭제</button>
                  <button onClick={() => toggleReviewFlag(entry.id)} type="button">
                    {entry.flagged ? "경고 해제" : "경고"}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      </fieldset>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));
}
