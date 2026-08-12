"use client";

import { useEffect, useState } from "react";

interface Note {
  id: string;
  content: string;
  authorName: string | null;
  flaggedAt: string | null;
  createdAt: string;
}

interface NotesResponse {
  ok: boolean;
  notes?: Note[];
  error?: string;
}

export function CoachNotesPanel({ coachId }: { coachId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const response = await fetch(`/api/coaches/${coachId}/notes`);
      const payload = (await response.json().catch(() => ({ ok: false }))) as NotesResponse;
      if (response.ok && payload.ok && payload.notes) setNotes(payload.notes);
      setIsLoading(false);
    }

    load();
  }, [coachId]);

  return (
    <div className="coach-notes-panel">
      {isLoading ? (
        <p className="coach-origin-empty-text">불러오는 중…</p>
      ) : notes.length === 0 ? (
        <p className="coach-origin-empty-text">등록된 메모가 없습니다.</p>
      ) : (
        <ul className="coach-notes-list">
          {notes.map((note) => (
            <li className={note.flaggedAt ? "flagged" : ""} key={note.id}>
              <div className="coach-notes-meta">
                <span>{note.authorName ?? "-"}</span>
                <time>{formatDateTime(note.createdAt)}</time>
              </div>
              <p>{note.content}</p>
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
