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
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  async function load() {
    setIsLoading(true);
    const response = await fetch(`/api/coaches/${coachId}/notes`);
    const payload = (await response.json().catch(() => ({ ok: false }))) as NotesResponse;
    if (response.ok && payload.ok && payload.notes) setNotes(payload.notes);
    setIsLoading(false);
  }

  useEffect(() => {
    // Data fetching is the external synchronization this panel needs on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addNote() {
    const content = draft.trim();
    if (!content || isSaving) return;

    setIsSaving(true);
    const response = await fetch(`/api/coaches/${coachId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content })
    });
    setIsSaving(false);

    if (response.ok) {
      setDraft("");
      await load();
    }
  }

  function startEdit(note: Note) {
    setEditingId(note.id);
    setEditingContent(note.content);
  }

  async function saveEdit(noteId: string) {
    const content = editingContent.trim();
    if (!content) return;

    await fetch(`/api/coaches/${coachId}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content })
    });
    setEditingId(null);
    await load();
  }

  async function removeNote(noteId: string) {
    if (!window.confirm("이 메모를 삭제할까요?")) return;
    await fetch(`/api/coaches/${coachId}/notes/${noteId}`, { method: "DELETE" });
    await load();
  }

  async function toggleWarn(noteId: string) {
    await fetch(`/api/coaches/${coachId}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toggleWarn: true })
    });
    await load();
  }

  return (
    <div className="coach-notes-panel">
      <div className="coach-notes-composer">
        <textarea
          onChange={(event) => setDraft(event.target.value)}
          placeholder="이 코치에 대한 메모를 남기세요"
          rows={2}
          value={draft}
        />
        <button disabled={!draft.trim() || isSaving} onClick={addNote} type="button">
          {isSaving ? "작성 중…" : "작성"}
        </button>
      </div>

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
              {editingId === note.id ? (
                <div className="coach-notes-edit">
                  <textarea
                    onChange={(event) => setEditingContent(event.target.value)}
                    rows={2}
                    value={editingContent}
                  />
                  <div className="coach-notes-actions">
                    <button onClick={() => saveEdit(note.id)} type="button">저장</button>
                    <button onClick={() => setEditingId(null)} type="button">취소</button>
                  </div>
                </div>
              ) : (
                <>
                  <p>{note.content}</p>
                  <div className="coach-notes-actions">
                    <button onClick={() => startEdit(note)} type="button">수정</button>
                    <button onClick={() => removeNote(note.id)} type="button">삭제</button>
                    <button onClick={() => toggleWarn(note.id)} type="button">
                      {note.flaggedAt ? "경고 해제" : "경고"}
                    </button>
                  </div>
                </>
              )}
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
