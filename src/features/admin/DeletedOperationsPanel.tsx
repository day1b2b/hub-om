"use client";

import { useEffect, useState } from "react";

interface DeletedOperationRow {
  companyName: string;
  courseName: string;
  deletedAt: string | null;
  deletedBy: string | null;
  endDate: string;
  operationId: string;
  roundNo: string | null;
  startDate: string;
}

interface ListResponse {
  error?: string;
  ok: boolean;
  operations?: DeletedOperationRow[];
}

export function DeletedOperationsPanel() {
  const [operations, setOperations] = useState<DeletedOperationRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function load() {
    setIsLoading(true);
    setError(null);
    const response = await fetch("/api/admin/deleted-operations");
    const payload = (await response.json().catch(() => ({ ok: false }))) as ListResponse;

    if (!response.ok || !payload.ok || !payload.operations) {
      setError(payload.error ?? "삭제 내역을 불러오지 못했습니다.");
      setIsLoading(false);
      return;
    }

    setOperations(payload.operations);
    setSelected(new Set());
    setIsLoading(false);
  }

  useEffect(() => {
    // Data fetching is the external synchronization this panel needs on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function toggleOne(operationId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === operations.length ? new Set() : new Set(operations.map((operation) => operation.operationId))
    );
  }

  async function restoreSelected() {
    if (selected.size === 0 || isBusy) return;

    setIsBusy(true);

    for (const operationId of selected) {
      await fetch("/api/admin/deleted-operations", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId })
      });
    }

    setIsBusy(false);
    await load();
  }

  if (isLoading) return <div className="coach-doc-empty"><span>불러오는 중…</span></div>;
  if (error) return <div className="coach-origin-empty-panel">{error}</div>;

  return (
    <section className="detail-section">
      <div className="section-title">
        <h2>삭제된 운영 차수</h2>
        <span>소프트 삭제된 회차만 표시됩니다. 복원하면 운영 현황에 다시 나타납니다.</span>
      </div>

      <div className="coach-admin-deleted-panel">
        <div className="coach-admin-deleted-toolbar">
          <span>총 {operations.length}건</span>
          <div className="coach-admin-deleted-actions">
            <button disabled={selected.size === 0 || isBusy} onClick={restoreSelected} type="button">
              {isBusy ? "복원 중" : "복원"}
            </button>
          </div>
        </div>

        {operations.length === 0 ? (
          <div className="coach-origin-empty-panel">삭제된 운영 차수가 없습니다.</div>
        ) : (
          <table className="coach-admin-deleted-table">
            <thead>
              <tr>
                <th>
                  <input checked={selected.size === operations.length} onChange={toggleAll} type="checkbox" />
                </th>
                <th>기업</th>
                <th>과정명</th>
                <th>회차</th>
                <th>일정</th>
                <th>삭제자</th>
                <th>삭제일시</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((operation) => (
                <tr key={operation.operationId}>
                  <td>
                    <input
                      checked={selected.has(operation.operationId)}
                      onChange={() => toggleOne(operation.operationId)}
                      type="checkbox"
                    />
                  </td>
                  <td>{operation.companyName}</td>
                  <td>{operation.courseName}</td>
                  <td>{operation.roundNo || "-"}</td>
                  <td>
                    {operation.startDate}
                    {operation.startDate !== operation.endDate ? ` ~ ${operation.endDate}` : ""}
                  </td>
                  <td>{operation.deletedBy || "-"}</td>
                  <td>{formatDateTime(operation.deletedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(date);
}
