"use client";

import { useState } from "react";
import type { SyncResult } from "@/lib/coaches/syncTypes";

interface SyncSource {
  id: string;
  name: string;
  endpoint: string;
  description: string;
}

const SYNC_SOURCES: SyncSource[] = [
  {
    id: "engagements",
    name: "코치 계약시트",
    endpoint: "/api/sync/engagements",
    description: "Google Drive의 계약 요청 시트(Office Excel)에서 코치·투입 계약을 동기화합니다."
  },
  {
    id: "notion",
    name: "Notion 코치",
    endpoint: "/api/admin/sync-notion",
    description: "Notion 코치 DB에서 코치 기본 정보를 동기화합니다."
  },
  {
    id: "samsung",
    name: "삼성 일정",
    endpoint: "/api/sync/samsung-schedule",
    description: "삼성 일정 시트에서 코치 일정을 동기화합니다."
  },
  {
    id: "all",
    name: "전체 한 번에",
    endpoint: "/api/sync/all",
    description: "위 세 소스를 순서대로 모두 동기화합니다."
  }
];

type Phase = "idle" | "previewing" | "applying" | "confirming" | "preview-done" | "applied" | "failed";

interface SourceState {
  phase: Phase;
  result?: SyncResult;
  error?: string;
  applied?: boolean;
}

interface SyncApiResponse {
  ok: boolean;
  dryRun?: boolean;
  result?: SyncResult;
  error?: string;
}

export function CoachSyncDashboard() {
  const [states, setStates] = useState<Record<string, SourceState>>({});

  function stateOf(id: string): SourceState {
    return states[id] ?? { phase: "idle" };
  }

  function setSource(id: string, next: SourceState) {
    setStates((prev) => ({ ...prev, [id]: next }));
  }

  async function callSync(source: SyncSource, dryRun: boolean) {
    setSource(source.id, { phase: dryRun ? "previewing" : "applying" });

    try {
      const response = await fetch(source.endpoint, { method: dryRun ? "GET" : "POST" });
      const payload = (await response.json().catch(() => ({ ok: false, error: "응답을 읽지 못했습니다." }))) as SyncApiResponse;

      if (!response.ok || !payload.ok || !payload.result) {
        setSource(source.id, { phase: "failed", error: payload.error ?? `요청 실패 (HTTP ${response.status})` });
        return;
      }

      setSource(source.id, {
        phase: dryRun ? "preview-done" : "applied",
        result: payload.result,
        applied: !dryRun
      });
    } catch (error) {
      setSource(source.id, { phase: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="sync-source-list">
      {SYNC_SOURCES.map((source) => {
        const state = stateOf(source.id);
        const busy = state.phase === "previewing" || state.phase === "applying";

        return (
          <article className="sync-card" key={source.id}>
            <div className="sync-card-head">
              <div>
                <h2>{source.name}</h2>
                <p>{source.description}</p>
              </div>
              <div className="sync-card-actions">
                <button
                  className="sync-btn sync-btn-preview"
                  disabled={busy}
                  onClick={() => callSync(source, true)}
                  type="button"
                >
                  {state.phase === "previewing" ? "미리보는 중…" : "미리보기"}
                </button>
                <button
                  className="sync-btn sync-btn-apply"
                  disabled={busy}
                  onClick={() => setSource(source.id, { ...state, phase: "confirming" })}
                  type="button"
                >
                  {state.phase === "applying" ? "반영 중…" : "실제 반영"}
                </button>
              </div>
            </div>

            {state.phase === "confirming" ? (
              <div className="sync-confirm" role="alertdialog" aria-label="실제 반영 확인">
                <p>
                  <strong>{source.name}</strong>을(를) 실제 DB에 반영합니다. 되돌리려면 백업이 필요합니다. 진행할까요?
                </p>
                <div className="sync-confirm-actions">
                  <button className="sync-btn sync-btn-danger" onClick={() => callSync(source, false)} type="button">
                    반영 실행
                  </button>
                  <button
                    className="sync-btn sync-btn-ghost"
                    onClick={() => setSource(source.id, { ...state, phase: state.result ? "preview-done" : "idle" })}
                    type="button"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : null}

            {state.phase === "failed" ? <p className="sync-error">오류: {state.error}</p> : null}

            {state.result ? <SyncResultView applied={state.applied ?? false} result={state.result} /> : null}
          </article>
        );
      })}
    </div>
  );
}

function SyncResultView({ result, applied }: { result: SyncResult; applied: boolean }) {
  const [showChanges, setShowChanges] = useState(false);

  return (
    <div className="sync-result">
      <div className={`sync-result-banner ${applied ? "applied" : "preview"}`}>
        {applied ? "✅ 실제 반영 완료" : "미리보기 결과 (저장 안 됨)"}
      </div>

      <dl className="sync-stats">
        <Stat label="읽은 행" value={result.totalRows} />
        <Stat label="생성" value={result.created} tone="create" />
        <Stat label="수정" value={result.updated} tone="update" />
        <Stat label="건너뜀" value={result.skipped} />
        <Stat label="오류" value={result.errors} tone={result.errors > 0 ? "error" : undefined} />
      </dl>

      {result.errorDetail.length > 0 ? (
        <details className="sync-detail">
          <summary>오류 상세 {result.errorDetail.length}건</summary>
          <ul>
            {result.errorDetail.slice(0, 100).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          {result.errorDetail.length > 100 ? <p className="sync-more">…외 {result.errorDetail.length - 100}건</p> : null}
        </details>
      ) : null}

      {result.changes && result.changes.length > 0 ? (
        <div className="sync-detail">
          <button className="sync-toggle" onClick={() => setShowChanges((prev) => !prev)} type="button">
            {showChanges ? "변경 내역 숨기기" : `변경 내역 보기 (${result.changes.length}건)`}
          </button>
          {showChanges ? (
            <ul className="sync-changes">
              {result.changes.slice(0, 200).map((change, index) => (
                <li key={index}>
                  <span className="sync-change-action">{change.action}</span>
                  <span>{change.coachName}</span>
                  {change.courseName ? <span className="sync-change-course">{change.courseName}</span> : null}
                  {change.details ? <span className="sync-change-details">{change.details}</span> : null}
                </li>
              ))}
              {result.changes.length > 200 ? <li className="sync-more">…외 {result.changes.length - 200}건</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "create" | "update" | "error" }) {
  return (
    <div className={`sync-stat ${tone ?? ""}`}>
      <dt>{label}</dt>
      <dd>{value.toLocaleString("ko-KR")}</dd>
    </div>
  );
}
