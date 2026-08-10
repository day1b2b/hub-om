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

export function OnsiteRequiredBackfillPanel() {
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedCount, setLastUpdatedCount] = useState<number | null>(null);

  async function loadCount() {
    setIsLoading(true);
    setError(null);
    const response = await fetch("/api/admin/onsite-required-backfill");
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
    if (!confirm(`완료·아카이빙 건을 포함해 현장 투입이 Y가 아닌 ${targetCount}건을 전부 Y로 변경합니다. 계속할까요?`)) return;

    setIsBusy(true);
    setError(null);

    const response = await fetch("/api/admin/onsite-required-backfill", { method: "POST" });
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
        <h2>현장 투입 일괄 Y 변경</h2>
        <span>완료·아카이빙 건을 포함해 소프트 삭제되지 않은 전체 회차가 대상입니다.</span>
      </div>

      <div className="coach-admin-deleted-panel">
        <div className="coach-admin-deleted-toolbar">
          <span>{isLoading ? "대상 건수 확인 중…" : `현재 Y가 아닌 회차 ${targetCount ?? 0}건`}</span>
          <div className="coach-admin-deleted-actions">
            <button disabled={isLoading || isBusy || !targetCount} onClick={applyBackfill} type="button">
              {isBusy ? "변경 중" : "전체 Y로 일괄 변경"}
            </button>
          </div>
        </div>

        {error ? <div className="coach-origin-empty-panel">{error}</div> : null}
        {lastUpdatedCount !== null ? (
          <div className="coach-origin-empty-panel">방금 {lastUpdatedCount}건을 Y로 변경했습니다.</div>
        ) : null}
      </div>
    </section>
  );
}
