"use client";

import { useState } from "react";
import type { MultiDealCourseInfo, MultiDealMode, SalesRevenueSyncResult } from "@/lib/data/salesRevenueSync";

const ENDPOINT = "/api/admin/sales-revenue";

type Phase = "idle" | "previewing" | "applying" | "confirming" | "preview-done" | "applied" | "failed";

interface PanelState {
  phase: Phase;
  result?: SalesRevenueSyncResult;
  error?: string;
  applied?: boolean;
}

interface ApiResponse {
  ok: boolean;
  dryRun?: boolean;
  result?: SalesRevenueSyncResult;
  error?: string;
}

const MODE_LABEL: Record<MultiDealMode, string> = {
  sum: "합산",
  max: "큰 값",
  min: "작은 값",
  exclude: "제외(반영 안 함)"
};

export function SalesRevenueSyncPanel() {
  const [state, setState] = useState<PanelState>({ phase: "idle" });
  // 금액이 다른 다중 딜의 코스ID별 처리 방식(미리보기에서 선택 → 반영 시 전달). 없으면 기본 '합산'.
  const [resolutions, setResolutions] = useState<Map<string, MultiDealMode>>(new Map());
  const busy = state.phase === "previewing" || state.phase === "applying";

  function setResolution(courseId: string, mode: MultiDealMode) {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(courseId, mode);
      return next;
    });
  }

  async function call(apply: boolean) {
    // 새 미리보기는 이전 선택을 초기화(데이터가 바뀌었을 수 있음).
    if (!apply) setResolutions(new Map());
    setState({ phase: apply ? "applying" : "previewing" });

    try {
      const response = await fetch(ENDPOINT, {
        method: apply ? "POST" : "GET",
        ...(apply
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ multiDealResolutions: Object.fromEntries(resolutions) })
            }
          : {})
      });
      const payload = (await response
        .json()
        .catch(() => ({ ok: false, error: "응답을 읽지 못했습니다." }))) as ApiResponse;

      if (!response.ok || !payload.ok || !payload.result) {
        setState({ phase: "failed", error: payload.error ?? `요청 실패 (HTTP ${response.status})` });
        return;
      }

      setState({ phase: apply ? "applied" : "preview-done", result: payload.result, applied: apply });
    } catch (error) {
      setState({ phase: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="sync-source-list">
      <article className="sync-card">
        <div className="sync-card-head">
          <div>
            <h2>세일즈맵 매출 가져오기</h2>
            <p>
              세일즈맵의 확정 과정(코스ID가 있는 딜)에서 금액을 읽어, 같은 코스ID 과정의 매출 칸을 채웁니다. 먼저{" "}
              <strong>미리보기</strong>로 무엇이 바뀌는지 확인한 뒤 <strong>매출 반영</strong>을 누르세요.
            </p>
          </div>
          <div className="sync-card-actions">
            <button
              className="sync-btn sync-btn-preview"
              disabled={busy}
              onClick={() => call(false)}
              type="button"
            >
              {state.phase === "previewing" ? "미리보는 중…" : "변경사항 미리보기"}
            </button>
            <button
              className="sync-btn sync-btn-apply"
              disabled={busy}
              onClick={() => setState({ ...state, phase: "confirming" })}
              type="button"
            >
              {state.phase === "applying" ? "실행 중…" : "매출 반영"}
            </button>
          </div>
        </div>

        {state.phase === "confirming" ? (
          <div className="sync-confirm" role="alertdialog" aria-label="매출 반영 확인">
            <p>
              <strong>세일즈맵 매출</strong>을 실제 DB의 과정 매출 칸에 덮어씁니다. 되돌리려면 백업이 필요합니다. 진행할까요?
            </p>
            <div className="sync-confirm-actions">
              <button className="sync-btn sync-btn-danger" onClick={() => call(true)} type="button">
                반영 실행
              </button>
              <button
                className="sync-btn sync-btn-ghost"
                onClick={() => setState({ ...state, phase: state.result ? "preview-done" : "idle" })}
                type="button"
              >
                취소
              </button>
            </div>
          </div>
        ) : null}

        {state.phase === "failed" ? <p className="sync-error">오류: {state.error}</p> : null}

        {state.result ? (
          <ResultView
            applied={state.applied ?? false}
            result={state.result}
            resolutions={resolutions}
            onSetResolution={setResolution}
          />
        ) : null}
      </article>
    </div>
  );
}

function MultiDealDecision({
  applied,
  items,
  resolutions,
  onSetResolution
}: {
  applied: boolean;
  items: MultiDealCourseInfo[];
  resolutions: Map<string, MultiDealMode>;
  onSetResolution: (courseId: string, mode: MultiDealMode) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div
      className="sync-detail"
      style={{ border: "1px solid #e6c200", background: "#fff9e0", borderRadius: 8, padding: 12 }}
    >
      <p style={{ fontWeight: 600, margin: 0 }}>
        🟡 금액이 서로 다른 딜이 여러 개인 코스ID ({items.length}건) — 어떻게 반영할지 고르세요
      </p>
      <p style={{ fontSize: 13, color: "#8a6d00", margin: "4px 0 10px" }}>
        분할 계약이면 <strong>합산</strong>, 최신/최종만 반영하려면 <strong>큰 값·작은 값</strong>, 반영하지 않으려면{" "}
        <strong>제외</strong>를 고르세요. (기본: 합산)
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((m) => {
          const selected = resolutions.get(m.courseId) ?? m.mode;
          return (
            <li
              key={m.courseId}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                opacity: (applied ? m.mode : selected) === "exclude" ? 0.55 : 1
              }}
            >
              <span style={{ fontWeight: 600 }}>코스 {m.courseId}</span>
              <span style={{ color: "#555" }}>
                {m.companyName ? `${m.companyName} ` : ""}
                {m.courseName ?? ""}
              </span>
              <span style={{ fontSize: 12, color: "#777", fontVariantNumeric: "tabular-nums" }}>
                딜 {m.dealCount}개 · 합계 {m.sum.toLocaleString("ko-KR")} · 최대 {m.max.toLocaleString("ko-KR")} · 최소{" "}
                {m.min.toLocaleString("ko-KR")}
              </span>
              {applied ? (
                <span style={{ marginLeft: "auto", fontWeight: 600 }}>
                  {MODE_LABEL[m.mode]}
                  {m.mode === "exclude" ? "" : ` → ${m.appliedAmount.toLocaleString("ko-KR")}`}
                </span>
              ) : (
                <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#777" }}>처리</span>
                  <select
                    value={selected}
                    onChange={(e) => onSetResolution(m.courseId, e.target.value as MultiDealMode)}
                  >
                    {(Object.keys(MODE_LABEL) as MultiDealMode[]).map((mode) => (
                      <option key={mode} value={mode}>
                        {MODE_LABEL[mode]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ResultView({
  applied,
  result,
  resolutions,
  onSetResolution
}: {
  applied: boolean;
  result: SalesRevenueSyncResult;
  resolutions: Map<string, MultiDealMode>;
  onSetResolution: (courseId: string, mode: MultiDealMode) => void;
}) {
  const [showChanges, setShowChanges] = useState(false);
  const realChanges = result.changes.filter((change) => change.action !== "same");

  return (
    <div className="sync-result">
      <div className={`sync-result-banner ${applied ? "applied" : "preview"}`}>
        {applied ? "✅ 매출 반영 완료" : "미리보기 결과 (저장 안 됨)"}
      </div>

      <p className="sync-summary-line">
        세일즈맵 {result.readCount}건 · 매칭 {result.matchedCourseIds} · 새로채움 {result.filled} · 변경 {result.changed} ·
        동일 {result.unchanged} · 미매칭 {result.unmatchedCourseIds.length} · 여러과정 {result.multiCourseIds.length}
        {result.dedupedCourseIds.length > 0 ? ` · 중복자동 ${result.dedupedCourseIds.length}` : ""}
        {result.multiDealCourseIds.length > 0 ? ` · 금액다른딜 ${result.multiDealCourseIds.length}` : ""}
      </p>
      {applied ? <p className="sync-summary-line">실제 갱신된 과정 행: {result.updatedRows.toLocaleString("ko-KR")}</p> : null}

      <MultiDealDecision
        applied={applied}
        items={result.multiDealCourseIds}
        resolutions={resolutions}
        onSetResolution={onSetResolution}
      />

      {result.dedupedCourseIds.length > 0 ? (
        <details className="sync-detail">
          <summary>금액이 같은 중복 딜 {result.dedupedCourseIds.length}건 → 1건 값으로 자동 반영</summary>
          <ul>
            {result.dedupedCourseIds.slice(0, 100).map((courseId) => (
              <li key={courseId}>{courseId}</li>
            ))}
          </ul>
          {result.dedupedCourseIds.length > 100 ? (
            <p className="sync-more">…외 {result.dedupedCourseIds.length - 100}건</p>
          ) : null}
        </details>
      ) : null}

      <dl className="sync-stats">
        <Stat label="세일즈맵 읽음" value={result.readCount} />
        <Stat label="매칭됨" value={result.matchedCourseIds} />
        <Stat label="새로 채움" value={result.filled} tone="create" />
        <Stat label="값 변경" value={result.changed} tone="update" />
        <Stat label="동일" value={result.unchanged} />
        <Stat
          label="미매칭"
          value={result.unmatchedCourseIds.length}
          tone={result.unmatchedCourseIds.length > 0 ? "error" : undefined}
        />
        <Stat label="여러 과정" value={result.multiCourseIds.length} />
      </dl>

      {result.unmatchedCourseIds.length > 0 ? (
        <details className="sync-detail">
          <summary>hub-om에 없는 코스ID {result.unmatchedCourseIds.length}건</summary>
          <ul>
            {result.unmatchedCourseIds.slice(0, 100).map((courseId) => (
              <li key={courseId}>{courseId}</li>
            ))}
          </ul>
          {result.unmatchedCourseIds.length > 100 ? (
            <p className="sync-more">…외 {result.unmatchedCourseIds.length - 100}건</p>
          ) : null}
        </details>
      ) : null}

      {result.multiCourseIds.length > 0 ? (
        <details className="sync-detail">
          <summary>
            같은 코스ID를 여러 과정에 채운 코스ID {result.multiCourseIds.length}건 (총 매출엔 1번만 집계)
          </summary>
          <ul>
            {result.multiCourseIds.slice(0, 100).map((courseId) => (
              <li key={courseId}>{courseId}</li>
            ))}
          </ul>
          {result.multiCourseIds.length > 100 ? (
            <p className="sync-more">…외 {result.multiCourseIds.length - 100}건</p>
          ) : null}
        </details>
      ) : null}

      {result.issues.length > 0 ? (
        <details className="sync-detail">
          <summary>알림 {result.issues.length}건</summary>
          <ul>
            {result.issues.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {realChanges.length > 0 ? (
        <div className="sync-detail">
          <button className="sync-toggle" onClick={() => setShowChanges((prev) => !prev)} type="button">
            {showChanges ? "변경 내역 숨기기" : `변경 내역 보기 (${realChanges.length}건)`}
          </button>
          {showChanges ? (
            <ul className="sync-changes">
              {realChanges.slice(0, 200).map((change, index) => (
                <li key={index}>
                  <span className="sync-change-action">{change.action === "fill" ? "새로채움" : "변경"}</span>
                  <span className="sync-change-course">코스 {change.courseId}</span>
                  <span>
                    {change.companyName ? `${change.companyName} ` : ""}
                    {change.courseName ?? ""}
                  </span>
                  <span className="sync-change-details">
                    {change.before == null ? "(빈칸)" : change.before.toLocaleString("ko-KR")} →{" "}
                    {change.after.toLocaleString("ko-KR")}
                  </span>
                </li>
              ))}
              {realChanges.length > 200 ? <li className="sync-more">…외 {realChanges.length - 200}건</li> : null}
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
