"use client";

import { useEffect, useState } from "react";

interface CountResponse {
  error?: string;
  ok: boolean;
  targetCount?: number;
}

interface ApplyResponse {
  error?: string;
  ok: boolean;
  updatedCount?: number;
}

export function OmAssignmentStatusBackfillPanel() {
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedCount, setLastUpdatedCount] = useState<number | null>(null);

  async function loadCount() {
    setIsLoading(true);
    setError(null);
    const response = await fetch("/api/admin/om-assignment-status-backfill");
    const payload = (await response.json().catch(() => ({ ok: false }))) as CountResponse;

    if (!response.ok || !payload.ok || payload.targetCount === undefined) {
      setError(payload.error ?? "대상 건수를 불러오지 못했습니다.");
      setIsLoading(false);
      return;
    }

    setTargetCount(payload.targetCount);
    setIsLoading(false);
  }

  useEffect(() => {
    // Data fetching is the external synchronization this panel needs on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCount();
  }, []);

  async function applyBackfill() {
    if (!targetCount || isBusy) return;
    if (!confirm(`OM은 이미 배정됐는데 상태가 "배정필요"로 남아있는 ${targetCount}건을 "배정예정"으로 변경합니다. 계속할까요?`)) return;

    setIsBusy(true);
    setError(null);

    const response = await fetch("/api/admin/om-assignment-status-backfill", { method: "POST" });
    const payload = (await response.json().catch(() => ({ ok: false }))) as ApplyResponse;

    if (!response.ok || !payload.ok || payload.updatedCount === undefined) {
      setError(payload.error ?? "일괄 변경에 실패했습니다.");
      setIsBusy(false);
      return;
    }

    setLastUpdatedCount(payload.updatedCount);
    setIsBusy(false);
    await loadCount();
  }

  return (
    <section className="detail-section">
      <div className="section-title">
        <h2>OM 배정 상태 일괄 정정</h2>
        <span>OM은 있는데 상태가 배정필요로 남은 건을 배정예정으로 맞춥니다.</span>
      </div>

      <div className="coach-admin-deleted-panel">
        <div className="coach-admin-deleted-toolbar">
          <span>{isLoading ? "대상 건수 확인 중…" : `현재 어긋난 회차 ${targetCount ?? 0}건`}</span>
          <div className="coach-admin-deleted-actions">
            <button disabled={isLoading || isBusy || !targetCount} onClick={applyBackfill} type="button">
              {isBusy ? "변경 중" : "배정예정으로 일괄 변경"}
            </button>
          </div>
        </div>

        {error ? <div className="coach-origin-empty-panel">{error}</div> : null}
        {lastUpdatedCount !== null ? (
          <div className="coach-origin-empty-panel">방금 {lastUpdatedCount}건을 배정예정으로 변경했습니다.</div>
        ) : null}
      </div>
    </section>
  );
}
