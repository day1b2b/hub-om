"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

type FilterKey = "all" | "note" | "review" | "history";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "전체",
  note: "메모",
  review: "리뷰",
  history: "수정이력"
};

const KIND_LABEL: Record<FeedEntry["kind"], string> = {
  note: "메모",
  review: "리뷰",
  history: "수정이력"
};

export function ContentManagementPanel() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [editRating, setEditRating] = useState(0);
  const [editFeedback, setEditFeedback] = useState("");

  async function load() {
    setIsLoading(true);
    setError(null);
    const response = await fetch("/api/admin/content-entries");
    const payload = (await response.json().catch(() => ({ ok: false }))) as FeedResponse;
    if (!response.ok || !payload.ok || !payload.entries) {
      setError(payload.error ?? "콘텐츠를 불러오지 못했습니다.");
      setIsLoading(false);
      return;
    }
    setEntries(payload.entries);
    setIsLoading(false);
  }

  useEffect(() => {
    // Data fetching is the external synchronization this panel needs on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const filteredEntries = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.kind === filter)),
    [entries, filter]
  );

  async function handleNoteAction(coachId: string, entryId: string, action: "delete" | "warn") {
    if (action === "delete" && !window.confirm("이 메모를 삭제할까요?")) return;

    await fetch(`/api/coaches/${coachId}/notes/${entryId}`, {
      method: action === "delete" ? "DELETE" : "PATCH",
      headers: action === "warn" ? { "content-type": "application/json" } : undefined,
      body: action === "warn" ? JSON.stringify({ toggleWarn: true }) : undefined
    });
    await load();
  }

  function startEditReview(entry: FeedEntry) {
    setEditingReviewId(entry.id);
    setEditRating(entry.rating ?? 0);
    setEditFeedback(entry.feedback ?? "");
  }

  async function saveReview(engagementId: string) {
    await fetch(`/api/engagements/${engagementId}/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: editRating || null, feedback: editFeedback })
    });
    setEditingReviewId(null);
    await load();
  }

  async function deleteReview(engagementId: string) {
    if (!window.confirm("이 리뷰(평점·한줄평)를 삭제할까요?")) return;
    await fetch(`/api/engagements/${engagementId}/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deleteReview: true })
    });
    await load();
  }

  async function toggleReviewFlag(engagementId: string) {
    await fetch(`/api/engagements/${engagementId}/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toggleFlag: true })
    });
    await load();
  }

  if (isLoading) return <div className="coach-doc-empty"><span>불러오는 중…</span></div>;
  if (error) return <div className="coach-origin-empty-panel">{error}</div>;

  return (
    <div className="coach-content-panel">
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

              {entry.kind === "review" && editingReviewId === entry.id ? (
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

              {entry.kind === "note" ? (
                <div className="coach-notes-actions">
                  <Link href={`/coaches/${entry.coachId}`}>수정</Link>
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
    </div>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  const datePart = `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, "0")}. ${String(date.getDate()).padStart(2, "0")}.`;
  const hours = date.getHours();
  const period = hours < 12 ? "오전" : "오후";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${datePart} ${period} ${displayHour}:${minutes}`;
}
