"use client";

import { useState } from "react";
import type { TeamUser } from "@/lib/data/teamUsers/teamUserTypes";

export function UserManagement({ initialUsers }: { initialUsers: TeamUser[] }) {
  const [users, setUsers] = useState<TeamUser[]>(initialUsers);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [slackId, setSlackId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), slackId: slackId.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "저장 실패");
      }
      const created = await res.json() as TeamUser;
      setUsers((prev) => [...prev, created]);
      setName("");
      setEmail("");
      setSlackId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected.size) return;
    if (!confirm(`${selected.size}명을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/users/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!res.ok) throw new Error();
      setUsers((prev) => prev.filter((u) => !selected.has(u.id)));
      setSelected(new Set());
    } catch {
      alert("삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(selected.size === users.length ? new Set() : new Set(users.map((u) => u.id)));
  }

  return (
    <div className="user-management">
      <form className="user-add-form" onSubmit={handleAdd}>
        <input
          required
          type="text"
          placeholder="이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="user-input"
        />
        <input
          required
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="user-input"
        />
        <input
          type="text"
          placeholder="Slack ID"
          value={slackId}
          onChange={(e) => setSlackId(e.target.value)}
          className="user-input"
        />
        <button className="user-add-btn" disabled={saving} type="submit">
          {saving ? "추가 중..." : "추가"}
        </button>
      </form>
      {error && <p className="om-request-error">{error}</p>}

      {users.length > 0 && (
        <>
          <div className="user-list-header">
            <span className="user-list-count">총 {users.length}명</span>
            {selected.size > 0 && (
              <button className="user-delete-btn" disabled={deleting} onClick={handleDelete}>
                {deleting ? "삭제 중..." : `${selected.size}명 삭제`}
              </button>
            )}
          </div>
          <table className="user-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selected.size === users.length}
                    onChange={toggleAll}
                  />
                </th>
                <th>이름</th>
                <th>이메일</th>
                <th>Slack ID</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={selected.has(u.id) ? "selected" : ""} onClick={() => toggleSelect(u.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={() => toggleSelect(u.id)}
                    />
                  </td>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.slackId || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {users.length === 0 && (
        <p className="user-empty">등록된 사용자가 없습니다.</p>
      )}
    </div>
  );
}
