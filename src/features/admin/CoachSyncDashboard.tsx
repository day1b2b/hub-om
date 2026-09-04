"use client";

import { useState } from "react";
import type { SyncResult } from "@/lib/coaches/syncTypes";

const CONTRACT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1xFgbLPL1ZLGxQws0ofK0kU8eehrFqEeAiwNbtQ56lyw/edit";

interface SyncSource {
  id: string;
  name: string;
  endpoint: string;
  description: string;
  externalUrl?: string;
  externalUrlLabel?: string;
}

const SYNC_SOURCES: SyncSource[] = [
  {
    id: "engagements",
    name: "계약시트 동기화",
    endpoint: "/api/sync/engagements",
    description:
      "구글시트 \"조교실습코치_일반계약요청\"에서 투입 이력과 스케줄을 가져옵니다. 2026년 이후 신규 코치는 자동 생성됩니다.",
    externalUrl: CONTRACT_SHEET_URL,
    externalUrlLabel: "시트 보기"
  },
  {
    id: "notion",
    name: "노션 코치 동기화",
    endpoint: "/api/admin/sync-notion",
    description:
      "노션 2026 DB에서 코치 정보(연락처, 이메일, 유형, 분야, 커리큘럼 등)를 가져옵니다. 연결 기준은 노션 \"No ID\"(예: CH-51)라서 노션에서 이름이 바뀌어도 같은 코치로 인식합니다."
  },
  {
    id: "notion-instructors",
    name: "노션 강사 동기화",
    endpoint: "/api/admin/sync-notion-instructors",
    description:
      "노션 강사 DB에서 강사 정보(소속, 전문분야, 담당 강의, 기본 강사료, 섭외지양 등)를 가져와 강사위키에 반영합니다. 연락처·이메일·생년월일은 저장하지 않습니다."
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

interface CoachSyncDashboardProps {
  sourceIds?: string[];
}

export function CoachSyncDashboard({ sourceIds }: CoachSyncDashboardProps = {}) {
  const sources = sourceIds ? SYNC_SOURCES.filter((source) => sourceIds.includes(source.id)) : SYNC_SOURCES;
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
      {sources.map((source) => {
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
                  {state.phase === "previewing" ? "미리보는 중…" : "변경사항 미리보기"}
                </button>
                <button
                  className="sync-btn sync-btn-apply"
                  disabled={busy}
                  onClick={() => setSource(source.id, { ...state, phase: "confirming" })}
                  type="button"
                >
                  {state.phase === "applying" ? "실행 중…" : "동기화 실행"}
                </button>
                {source.externalUrl ? (
                  <a className="sync-external-link" href={source.externalUrl} rel="noreferrer" target="_blank">
                    {source.externalUrlLabel ?? "바로가기"}
                  </a>
                ) : null}
              </div>
            </div>

            {state.phase === "confirming" ? (
              <div className="sync-confirm" role="alertdialog" aria-label="동기화 실행 확인">
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

            {state.result ? (
              <SyncResultView applied={state.applied ?? false} result={state.result} sourceName={source.name} />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function SyncResultView({
  applied,
  result,
  sourceName
}: {
  applied: boolean;
  result: SyncResult;
  sourceName: string;
}) {
  const [showChanges, setShowChanges] = useState(false);
  const hasChanges = result.changes ? result.changes.length > 0 : result.created > 0 || result.updated > 0;

  return (
    <div className="sync-result">
      <div className={`sync-result-banner ${applied ? "applied" : "preview"}`}>
        {applied ? "✅ 실제 반영 완료" : "미리보기 결과 (저장 안 됨)"}
      </div>

      <p className="sync-summary-line">
        {sourceName} {result.totalRows}명 신규 {result.created}명 업데이트 {result.updated}명 스킵 {result.skipped}건
      </p>
      {!hasChanges ? (
        <p className="sync-summary-empty">변경 사항이 없습니다. DB와 {sourceName}이(가) 일치합니다.</p>
      ) : null}

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
