"use client";

import { useEffect, useState } from "react";

interface DeletedCoachRow {
  id: string;
  name: string;
  workType: string | null;
  status: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

interface ListResponse {
  ok: boolean;
  coaches?: DeletedCoachRow[];
  error?: string;
}

export function DeletedCoachesPanel() {
  const [coaches, setCoaches] = useState<DeletedCoachRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function load() {
    setIsLoading(true);
    setError(null);
    const response = await fetch("/api/admin/deleted-coaches");
    const payload = (await response.json().catch(() => ({ ok: false }))) as ListResponse;
    if (!response.ok || !payload.ok || !payload.coaches) {
      setError(payload.error ?? "삭제 내역을 불러오지 못했습니다.");
      setIsLoading(false);
      return;
    }
    setCoaches(payload.coaches);
    setSelected(new Set());
    setIsLoading(false);
  }

  useEffect(() => {
    // Data fetching is the external synchronization this panel needs on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === coaches.length ? new Set() : new Set(coaches.map((coach) => coach.id))));
  }

  async function restoreSelected() {
    if (selected.size === 0 || isBusy) return;
    setIsBusy(true);
    for (const id of selected) {
      await fetch("/api/admin/deleted-coaches", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
    }
    setIsBusy(false);
    await load();
  }

  async function permanentlyDeleteSelected() {
    if (selected.size === 0 || isBusy) return;
    if (!window.confirm(`선택한 ${selected.size}명을 완전삭제합니다. 되돌릴 수 없습니다. 진행할까요?`)) return;

    setIsBusy(true);
    for (const id of selected) {
      await fetch("/api/admin/deleted-coaches", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
    }
    setIsBusy(false);
    await load();
  }

  if (isLoading) return <div className="coach-doc-empty"><span>불러오는 중…</span></div>;
  if (error) return <div className="coach-origin-empty-panel">{error}</div>;

  return (
    <div className="coach-admin-deleted-panel">
      <div className="coach-admin-deleted-toolbar">
        <span>총 {coaches.length}명</span>
        <div className="coach-admin-deleted-actions">
          <button disabled={selected.size === 0 || isBusy} onClick={restoreSelected} type="button">
            복원
          </button>
          <button
            className="coach-admin-deleted-danger"
            disabled={selected.size === 0 || isBusy}
            onClick={permanentlyDeleteSelected}
            type="button"
          >
            영구삭제
          </button>
        </div>
      </div>

      {coaches.length === 0 ? (
        <div className="coach-origin-empty-panel">삭제된 코치가 없습니다.</div>
      ) : (
        <table className="coach-admin-deleted-table">
          <thead>
            <tr>
              <th>
                <input
                  checked={selected.size === coaches.length}
                  onChange={toggleAll}
                  type="checkbox"
                />
              </th>
              <th>이름</th>
              <th>근무유형</th>
              <th>상태</th>
              <th>삭제자</th>
              <th>삭제일</th>
            </tr>
          </thead>
          <tbody>
            {coaches.map((coach) => (
              <tr key={coach.id}>
                <td>
                  <input
                    checked={selected.has(coach.id)}
                    onChange={() => toggleOne(coach.id)}
                    type="checkbox"
                  />
                </td>
                <td>{coach.name}</td>
                <td>{coach.workType || "-"}</td>
                <td>{coach.status}</td>
                <td>{coach.deletedBy || "-"}</td>
                <td>{formatDate(coach.deletedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[1]}.${Number(match[2])}.${Number(match[3])}` : value;
}
