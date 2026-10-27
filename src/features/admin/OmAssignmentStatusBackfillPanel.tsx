"use client";

import { useEffect, useState } from "react";

interface Preview {
  targetCount: number;
  planned: number;
  archiveNeeded: number;
  retrospectiveDone: number;
}

interface CountResponse extends Partial<Preview> {
  error?: string;
  ok: boolean;
}

interface ApplyResponse {
  error?: string;
  ok: boolean;
  updatedCount?: number;
}

export function OmAssignmentStatusBackfillPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const targetCount = preview?.targetCount ?? null;
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedCount, setLastUpdatedCount] = useState<number | null>(null);

  async function loadCount() {
    setIsLoading(true);
    setError(null);
    const response = await fetch("/api/admin/om-assignment-status-backfill");
    const payload = (await response.json().catch(() => ({ ok: false }))) as CountResponse;

    const { targetCount: total, planned, archiveNeeded, retrospectiveDone } = payload;
    if (!response.ok || !payload.ok || total === undefined || planned === undefined || archiveNeeded === undefined || retrospectiveDone === undefined) {
      setError(payload.error ?? "대상 건수를 불러오지 못했습니다.");
      setIsLoading(false);
      return;
    }

    setPreview({ targetCount: total, planned, archiveNeeded, retrospectiveDone });
    setIsLoading(false);
  }

  useEffect(() => {
    // Data fetching is the external synchronization this panel needs on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCount();
  }, []);

  async function applyBackfill() {
    if (!preview || !preview.targetCount || isBusy) return;
    if (!confirm(`OM은 이미 배정됐는데 상태가 "배정필요"로 남아있는 ${preview.targetCount}건을 변경합니다.\n\n` +
      `· 시작 전·진행 중 ${preview.planned}건 → 배정예정\n· 끝났고 아카이빙 남음 ${preview.archiveNeeded}건 → 아카이빙필요\n` +
      `· 끝났고 아카이빙 완료 ${preview.retrospectiveDone}건 → 회고완료\n\n계속할까요?`)) return;

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
        <span>OM은 있는데 상태가 배정필요로 남은 건을 교육 날짜에 맞춰 정리합니다. 끝난 교육은 배정예정이 아니라 아카이빙 상태에 따라 바꿉니다.</span>
      </div>

      <div className="coach-admin-deleted-panel">
        <div className="coach-admin-deleted-toolbar">
          <span>
            {isLoading || !preview
              ? "대상 건수 확인 중…"
              : `현재 어긋난 회차 ${preview.targetCount}건 · 배정예정 ${preview.planned} · 아카이빙필요 ${preview.archiveNeeded} · 회고완료 ${preview.retrospectiveDone}`}
          </span>
          <div className="coach-admin-deleted-actions">
            <button disabled={isLoading || isBusy || !targetCount} onClick={applyBackfill} type="button">
              {isBusy ? "변경 중" : "날짜에 맞춰 일괄 변경"}
            </button>
          </div>
        </div>

        {error ? <div className="coach-origin-empty-panel">{error}</div> : null}
        {lastUpdatedCount !== null ? (
          <div className="coach-origin-empty-panel">방금 {lastUpdatedCount}건의 상태를 변경했습니다.</div>
        ) : null}
      </div>
    </section>
  );
}
