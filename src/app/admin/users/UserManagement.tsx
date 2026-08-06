"use client";

import { useState } from "react";
import { TEAM_OPTIONS } from "@/lib/data/teamUsers/teamUserTypes";
import type { TeamUser, TeamUserInput, TeamUserRole } from "@/lib/data/teamUsers/teamUserTypes";

const ROLE_OPTIONS: { value: TeamUserRole; label: string }[] = [
  { value: "om", label: "OM" },
  { value: "ld", label: "LD" }
];
const ROLE_LABEL: Record<TeamUserRole, string> = { ld: "LD", om: "OM" };
type TeamFilter = "전체" | "AX 1파트" | "AX 2파트" | "AX 3파트";

export function UserManagement({ initialUsers }: { initialUsers: TeamUser[] }) {
  const [users, setUsers] = useState<TeamUser[]>(initialUsers);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [slackId, setSlackId] = useState("");
  const [team, setTeam] = useState("");
  const [role, setRole] = useState<TeamUserRole | "">("");
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("전체");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [assignRole, setAssignRole] = useState<TeamUserRole>("om");
  const [assigning, setAssigning] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamValue, setEditingTeamValue] = useState("");
  const [savingTeamId, setSavingTeamId] = useState<string | null>(null);
  const [teamEditError, setTeamEditError] = useState<string | null>(null);

  const filteredUsers =
    teamFilter === "전체" ? users : users.filter((u) => u.team === teamFilter);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          slackId: slackId.trim(),
          team: team || undefined,
          role: role || undefined,
        }),
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
      setTeam("");
      setRole("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkAdd() {
    const inputs = parseBulkRows(bulkText);
    if (inputs.length === 0) {
      setBulkError("추가할 내용이 없습니다. 팀, 이름, 이메일, Slack ID 순서로 붙여넣어 주세요.");
      return;
    }

    setBulkSaving(true);
    setBulkError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "저장 실패");
      }
      const created = await res.json() as TeamUser[];
      setUsers((prev) => [...prev, ...created]);
      setBulkText("");
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setBulkSaving(false);
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

  async function handleAssignRole() {
    if (!selected.size) return;
    const label = ROLE_LABEL[assignRole];
    if (!confirm(`선택한 ${selected.size}명을 ${label}(으)로 지정하시겠습니까?`)) return;
    setAssigning(true);
    try {
      const res = await fetch("/api/admin/users/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], role: assignRole }),
      });
      if (!res.ok) throw new Error();
      setUsers((prev) => prev.map((u) => (selected.has(u.id) ? { ...u, role: assignRole } : u)));
      setSelected(new Set());
    } catch {
      alert("구분 지정에 실패했습니다.");
    } finally {
      setAssigning(false);
    }
  }

  function startEditTeam(u: TeamUser) {
    setTeamEditError(null);
    setEditingTeamId(u.id);
    setEditingTeamValue(u.team ?? "");
  }

  function cancelEditTeam() {
    setEditingTeamId(null);
    setEditingTeamValue("");
    setTeamEditError(null);
  }

  async function handleSaveTeam(id: string) {
    setSavingTeamId(id);
    setTeamEditError(null);
    try {
      const res = await fetch("/api/admin/users/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, team: editingTeamValue || null }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "저장 실패");
      }
      const updated = await res.json() as TeamUser;
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      setEditingTeamId(null);
      setEditingTeamValue("");
    } catch (err) {
      setTeamEditError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setSavingTeamId(null);
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
    const filteredIds = filteredUsers.map((u) => u.id);
    const allSelected = filteredIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        filteredIds.forEach((id) => next.delete(id));
      } else {
        filteredIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  const filteredAllSelected =
    filteredUsers.length > 0 && filteredUsers.every((u) => selected.has(u.id));

  return (
    <div className="user-management">
      <form className="user-add-form" style={{ flexWrap: "nowrap" }} onSubmit={handleAdd}>
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="user-input"
        >
          <option value="">팀 선택</option>
          {TEAM_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as TeamUserRole | "")}
          className="user-input"
        >
          <option value="">구분 선택</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
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

      <div className="om-manage-filters">
        {(["전체", "AX 1파트", "AX 2파트", "AX 3파트"] as TeamFilter[]).map((f) => {
          const count = f === "전체" ? users.length : users.filter((u) => u.team === f).length;
          return (
            <button
              key={f}
              className={`om-filter-btn${teamFilter === f ? " selected" : ""}`}
              onClick={() => { setTeamFilter(f); setSelected(new Set()); }}
              type="button"
            >
              {f}
              <span className="om-filter-count">{count}</span>
            </button>
          );
        })}
      </div>

      {filteredUsers.length > 0 && (
        <>
          <div className="user-list-header">
            <span className="user-list-count">
              {teamFilter === "전체" ? `총 ${users.length}명` : `${teamFilter} ${filteredUsers.length}명`}
            </span>
            {selected.size > 0 && (
              <div className="user-bulk-assign">
                <select
                  value={assignRole}
                  onChange={(e) => setAssignRole(e.target.value as TeamUserRole)}
                  className="user-input"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <button className="user-add-btn" disabled={assigning} onClick={handleAssignRole} type="button">
                  {assigning ? "지정 중..." : `${selected.size}명 구분 지정`}
                </button>
                <button className="user-delete-btn" disabled={deleting} onClick={handleDelete}>
                  {deleting ? "삭제 중..." : `${selected.size}명 삭제`}
                </button>
              </div>
            )}
          </div>
          {teamEditError && <p className="om-request-error">{teamEditError}</p>}
          <table className="user-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={filteredAllSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th>팀</th>
                <th>구분</th>
                <th>이름</th>
                <th>이메일</th>
                <th>Slack ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className={selected.has(u.id) ? "selected" : ""} onClick={() => toggleSelect(u.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={() => toggleSelect(u.id)}
                    />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {editingTeamId === u.id ? (
                      <div className="user-team-edit">
                        <select
                          className="user-input"
                          value={editingTeamValue}
                          onChange={(e) => setEditingTeamValue(e.target.value)}
                        >
                          <option value="">미지정</option>
                          {TEAM_OPTIONS.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="user-add-btn"
                          disabled={savingTeamId === u.id}
                          onClick={() => handleSaveTeam(u.id)}
                        >
                          {savingTeamId === u.id ? "저장 중..." : "저장"}
                        </button>
                        <button type="button" className="user-delete-btn" onClick={cancelEditTeam}>
                          취소
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="user-team-cell" onClick={() => startEditTeam(u)}>
                        {u.team || "-"}
                      </button>
                    )}
                  </td>
                  <td>{u.role ? ROLE_LABEL[u.role] : "-"}</td>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.slackId || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {filteredUsers.length === 0 && (
        <p className="user-empty">
          {teamFilter === "전체" ? "등록된 사용자가 없습니다." : `${teamFilter} 사용자가 없습니다.`}
        </p>
      )}

      <div className="user-bulk-add">
        <p className="user-bulk-add-label">여러 명 한 번에 추가 (엑셀에서 팀, 구분(OM/LD), 이름, 이메일, Slack ID 순서로 복사해서 붙여넣기)</p>
        <textarea
          className="user-bulk-textarea"
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={"AX 1파트\tOM\t김정선\tjungsun.kim@day1company.co.kr\tjungsun.kim"}
          rows={6}
          value={bulkText}
        />
        {bulkError && <p className="om-request-error">{bulkError}</p>}
        <button className="user-add-btn" disabled={bulkSaving} onClick={handleBulkAdd} type="button">
          {bulkSaving ? "추가 중..." : "일괄 추가"}
        </button>
      </div>
    </div>
  );
}

function parseRole(value: string | undefined): TeamUserRole | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "ld") return "ld";
  if (normalized === "om") return "om";
  return undefined;
}

function parseBulkRows(text: string): TeamUserInput[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|,/).map((cell) => cell.trim()))
    .filter((cells) => !(cells[0] === "팀" && (cells[1] === "이름" || cells[1] === "구분")))
    .map(([team, role, name, email, slackId]) => ({
      email: email ?? "",
      name: name ?? "",
      slackId: slackId ?? "",
      team: team || undefined,
      role: parseRole(role)
    }))
    .filter((input) => input.name && input.email);
}
