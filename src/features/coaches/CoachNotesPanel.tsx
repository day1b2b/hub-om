"use client";

import { useEffect, useState } from "react";
import { PeoplePinned } from "@/features/people/PeopleProfile";

interface Note {
  id: string;
  content: string;
  authorName: string | null;
  /** 메모 "고정" 표시. 저장 칸 이름은 예전 "경고" 그대로 flagged_at이다. */
  flaggedAt: string | null;
  createdAt: string;
}

interface NotesResponse {
  ok: boolean;
  notes?: Note[];
  error?: string;
}

export interface CoachPinnedItem {
  key: string;
  text: string;
  tone: "bad" | "warn";
}

// 상세 화면의 고정 알림과 운영 메모 칸이 같은 메모를 쓴다. 같은 순간에 두 번 부르지 않도록 진행 중인 요청만 나눠 쓴다.
const inFlight = new Map<string, Promise<Note[] | null>>();

function loadCoachNotes(coachId: string): Promise<Note[] | null> {
  const pending = inFlight.get(coachId);
  if (pending) return pending;
  const request = fetch(`/api/coaches/${coachId}/notes`)
    .then(async (response) => {
      const payload = (await response.json().catch(() => ({ ok: false }))) as NotesResponse;
      return response.ok && payload.ok && payload.notes ? payload.notes : null;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(coachId));
  inFlight.set(coachId, request);
  return request;
}

function useCoachNotes(coachId: string) {
  // 어느 코치의 메모인지 같이 들고 있어서, 코치가 바뀌면 받기 전까지 불러오는 중으로 본다.
  const [loaded, setLoaded] = useState<{ coachId: string; notes: Note[] } | null>(null);

  useEffect(() => {
    let active = true;
    loadCoachNotes(coachId).then((notes) => {
      if (active) setLoaded({ coachId, notes: notes ?? [] });
    });
    return () => {
      active = false;
    };
  }, [coachId]);

  const isLoading = loaded?.coachId !== coachId;
  return { notes: isLoading ? [] : loaded.notes, isLoading };
}

/** 운영 메모 칸. 고정 메모를 위로 올리고 📌로 표시한다. 읽기 전용(고정·수정은 메모·리뷰 관리에서). */
export function CoachNotesPanel({ coachId }: { coachId: string }) {
  const { notes, isLoading } = useCoachNotes(coachId);
  return <CoachNotesList isLoading={isLoading} notes={notes} />;
}

export function CoachNotesList({ isLoading, notes }: { isLoading: boolean; notes: Note[] }) {
  if (isLoading) return <p className="coach-origin-empty-text">불러오는 중…</p>;
  if (notes.length === 0) return <p className="coach-origin-empty-text">등록된 메모가 없습니다.</p>;

  const ordered = [...pinnedNotes(notes), ...notes.filter((note) => !note.flaggedAt)];
  return (
    <div className="coach-notes-panel">
      <ul className="coach-notes-list">
        {ordered.map((note) => (
          <li className={note.flaggedAt ? "flagged" : ""} key={note.id}>
            <div className="coach-notes-meta">
              {note.flaggedAt ? <span>📌 고정</span> : null}
              <span>{note.authorName ?? "-"}</span>
              <time>{formatDateTime(note.createdAt)}</time>
            </div>
            <p>{note.content}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 상세 상단 고정 알림. 서버에서 정한 알림(코치 DB 상태·상태 메모·복귀 예정) 뒤에 고정 메모를 붙인다. */
export function CoachPinnedNotes({ coachId, items }: { coachId: string; items: CoachPinnedItem[] }) {
  const { notes } = useCoachNotes(coachId);
  return <CoachPinnedList items={items} notes={notes} />;
}

export function CoachPinnedList({ items, notes }: { items: CoachPinnedItem[]; notes: Note[] }) {
  const noteItems = pinnedNotes(notes).map((note) => ({
    key: `note-${note.id}`,
    text: [note.content, note.authorName, formatShortDate(note.createdAt)].filter(Boolean).join(" · "),
    tone: "warn" as const
  }));
  return <PeoplePinned items={[...items, ...noteItems]} />;
}

/** 고정 메모를 최근 고정한 순으로. */
function pinnedNotes(notes: Note[]): Note[] {
  return notes
    .filter((note) => note.flaggedAt)
    .sort((a, b) => (b.flaggedAt ?? "").localeCompare(a.flaggedAt ?? ""));
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const short = `${date.getMonth() + 1}.${date.getDate()}`;
  return date.getFullYear() === new Date().getFullYear() ? short : `${date.getFullYear()}.${short}`;
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
