"use client";

import { useEffect, useState } from "react";

interface MatchedItem {
  course: string;
  instructor: string;
  date: string;
  overall: string;
  posPct: number | null;
  respondents: number | null;
  operationId: string;
  operationCourse: string;
  operationCompany: string;
  operationDates: string;
  currentSatisfaction: string;
  score: number;
}

interface AmbiguousItem {
  recordId: string;
  course: string;
  instructor: string;
  date: string;
  overall: string;
  posPct: number | null;
  candidates: Array<{ operationId: string; courseName: string; company: string; dates: string; score: number }>;
}

interface LinkResponse {
  ok: boolean;
  error?: string;
  applied?: Array<{ operation: string; value: string }>;
  skipped?: Array<{ course: string; date: string; reason: string }>;
  failed?: Array<{ error: string }>;
}

interface UnmatchedItem {
  course: string;
  instructor: string;
  date: string;
  courseId: string;
  reason?: string;
}

interface PreviewResponse {
  ok: boolean;
  error?: string;
  reauthRequired?: boolean;
  stats?: { total: number; matched: number; ambiguous: number; unmatched: number; operations: number };
  matched?: MatchedItem[];
  ambiguous?: AmbiguousItem[];
  unmatched?: UnmatchedItem[];
}

interface ApplyResponse {
  ok: boolean;
  error?: string;
  stats?: { applied: number; skipped: number; failed: number };
  applied?: Array<{ course: string; date: string; overall: string; operation: string }>;
  skipped?: Array<{ course: string; date: string; reason: string }>;
  failed?: Array<{ course: string; date: string; error: string }>;
}

export function SatisfactionMatchPreview() {
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [tabTitle, setTabTitle] = useState("eduops_log");
  const [headerRowNumber, setHeaderRowNumber] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reauthRequired, setReauthRequired] = useState(false);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null);
  const [linking, setLinking] = useState("");
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});
  const [linkNote, setLinkNote] = useState<Record<string, string>>({});

  /** 모호 건을 사람이 고른 운영에 수동 연결한다. 자동 반영과 같은 안전 규칙(빈 회차만)을 서버가 적용한다. */
  async function runLink(recordId: string, operationId: string) {
    if (!recordId || !operationId || linking) return;

    setLinking(recordId);
    setLinkNote((prev) => ({ ...prev, [recordId]: "" }));
    try {
      const response = await fetch("/api/admin/satisfaction/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordId, operationId, spreadsheetUrl, tabTitle, headerRowNumber })
      });
      const payload = (await response.json()) as LinkResponse;
      if (!response.ok || !payload.ok) {
        setLinkNote((prev) => ({ ...prev, [recordId]: payload.error ?? "연결에 실패했습니다." }));
        return;
      }
      if (payload.applied && payload.applied.length > 0) {
        await runPreview(); // 연결되면 matched로 이동하므로 최신 상태로 다시 읽는다
        return;
      }
      const reason = payload.skipped?.[0]?.reason ?? payload.failed?.[0]?.error ?? "반영되지 않았어요.";
      setLinkNote((prev) => ({ ...prev, [recordId]: reason }));
    } catch {
      setLinkNote((prev) => ({ ...prev, [recordId]: "네트워크 오류가 발생했습니다." }));
    } finally {
      setLinking("");
    }
  }

  /** 자동연결 건을 운영 회차 만족도에 기록한다. 이미 값이 있는 회차는 서버가 건너뛴다. */
  async function runApply() {
    const count = data?.stats?.matched ?? 0;
    if (count === 0) return;

    setConfirming(false);
    setApplying(true);
    setError("");
    setApplyResult(null);
    try {
      const response = await fetch("/api/admin/satisfaction/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spreadsheetUrl, tabTitle, headerRowNumber })
      });
      const payload = (await response.json()) as ApplyResponse;
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "반영에 실패했습니다.");
        return;
      }
      setApplyResult(payload);
      await runPreview(); // 반영 후 현재값이 바뀌므로 최신 상태로 다시 읽는다
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setApplying(false);
    }
  }

  async function runPreview() {
    setLoading(true);
    setError("");
    setReauthRequired(false);
    setConfirming(false);
    setData(null);

    try {
      const response = await fetch("/api/admin/satisfaction/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spreadsheetUrl, tabTitle, headerRowNumber })
      });
      const payload = (await response.json()) as PreviewResponse;

      if (!response.ok || !payload.ok) {
        setReauthRequired(Boolean(payload.reauthRequired));
        setError(payload.error ?? "미리보기 생성에 실패했습니다.");
        return;
      }
      setData(payload);
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  // 화면을 열면 서버 기본 시트(SATISFACTION_SHEET_URL)로 즉시 최신 매칭을 불러온다.
  // 기본값이 없으면 서버가 시트 주소 입력을 안내하는 오류를 돌려주고, 아래 입력칸으로 조회하면 된다.
  useEffect(() => {
    // setTimeout으로 한 틱 미뤄 effect 본문의 동기 setState(연쇄 렌더) 경고를 피한다
    const timer = setTimeout(() => {
      void runPreview();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = data?.stats;
  const matched = data?.matched ?? [];
  const ambiguous = data?.ambiguous ?? [];
  const unmatched = data?.unmatched ?? [];

  return (
    <>
      {error ? (
        <p className="sync-error">
          {error}
          {reauthRequired ? (
            <>
              {" "}
              <a href="/sign-in?reauth=google&callbackUrl=/admin/satisfaction-preview">Google 권한 다시 받기</a>
            </>
          ) : null}
        </p>
      ) : null}

      {loading && !data ? <p className="satisfaction-loading">최신 매칭 상태를 불러오는 중…</p> : null}

      {stats ? (
        <dl className="sync-stats satisfaction-summary">
          <Stat label="시트 행" value={stats.total} />
          <Stat label="운영" value={stats.operations} />
          <Stat label="자동연결" value={stats.matched} tone="create" />
          <Stat label="모호" value={stats.ambiguous} />
          <Stat label="미매칭" value={stats.unmatched} tone={stats.unmatched > 0 ? "error" : undefined} />
        </dl>
      ) : null}

      {applyResult?.stats ? (
        <div className="sync-result satisfaction-apply-result">
          <div className="sync-result-banner applied">
            ✅ 반영 완료 — 기록 {applyResult.stats.applied}건 · 건너뜀 {applyResult.stats.skipped}건
            {applyResult.stats.failed > 0 ? ` · 실패 ${applyResult.stats.failed}건` : ""}
          </div>
          {applyResult.applied && applyResult.applied.length > 0 ? (
            <ul className="satisfaction-apply-list">
              {applyResult.applied.map((item, index) => (
                <li key={`a-${index}`}>
                  {item.operation} ← <strong>{item.overall}</strong>
                </li>
              ))}
            </ul>
          ) : null}
          {applyResult.failed && applyResult.failed.length > 0 ? (
            <ul className="satisfaction-apply-list is-failed">
              {applyResult.failed.map((item, index) => (
                <li key={`f-${index}`}>
                  {item.course} ({item.date}) — {item.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {matched.length > 0 ? (
        <section className="table-section">
          <div className="table-header">
            <h2>자동 연결 가능</h2>
            <span>{matched.length}건</span>
          </div>

          <div className="satisfaction-apply-bar">
            <button
              className="sync-btn sync-btn-apply"
              type="button"
              onClick={() => setConfirming(true)}
              disabled={applying || loading}
            >
              {applying ? "반영 중…" : `운영 회차에 반영 (${matched.length}건)`}
            </button>
            <span className="satisfaction-apply-note">
              아래 표의 만족도를 운영 회차에 기록합니다. 이미 값이 있는 회차(현재값이 “미입력”이 아닌 행)는 그대로 둡니다.
            </span>
          </div>

          {confirming ? (
            <div className="sync-confirm" role="alertdialog" aria-label="만족도 반영 확인">
              <p>
                <strong>자동연결 {matched.length}건</strong>을 운영 회차 만족도에 반영합니다. 이미 값이 있는 회차는
                그대로 둡니다. 진행할까요?
              </p>
              <div className="sync-confirm-actions">
                <button className="sync-btn sync-btn-danger" type="button" onClick={runApply}>
                  반영 실행
                </button>
                <button className="sync-btn sync-btn-ghost" type="button" onClick={() => setConfirming(false)}>
                  취소
                </button>
              </div>
            </div>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>시트 과정</th>
                  <th>강사</th>
                  <th>일자</th>
                  <th>만족도</th>
                  <th>연결될 운영</th>
                  <th>운영 일정</th>
                  <th>현재값 → 반영</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((item, index) => (
                  <tr key={`m-${index}`}>
                    <td>{item.course}</td>
                    <td>{item.instructor}</td>
                    <td>{item.date}</td>
                    <td>
                      <strong>{item.overall}</strong>
                      {item.posPct != null ? <span>긍정 {item.posPct}%</span> : null}
                    </td>
                    <td>
                      <strong>{item.operationCourse}</strong>
                      {item.operationCompany ? <span>{item.operationCompany}</span> : null}
                    </td>
                    <td>{item.operationDates}</td>
                    <td>
                      {item.currentSatisfaction ? (
                        item.currentSatisfaction
                      ) : (
                        <span className="satisfaction-will-fill">미입력 → {item.overall}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {ambiguous.length > 0 ? (
        <section className="table-section">
          <div className="table-header">
            <h2>모호 · 후보 중에서 연결</h2>
            <span>{ambiguous.length}건</span>
          </div>
          <p className="satisfaction-section-note">
            후보가 여럿이라 자동 연결하지 않았어요. 맞는 운영을 골라 연결하세요. 이미 값이 있는 회차는 덮어쓰지 않습니다.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>시트 과정</th>
                  <th>강사</th>
                  <th>일자</th>
                  <th>만족도</th>
                  <th>연결할 운영 선택</th>
                </tr>
              </thead>
              <tbody>
                {ambiguous.map((item, index) => {
                  const chosen = linkChoice[item.recordId] ?? item.candidates[0]?.operationId ?? "";
                  return (
                    <tr key={item.recordId || `a-${index}`}>
                      <td>{item.course}</td>
                      <td>{item.instructor}</td>
                      <td>{item.date}</td>
                      <td>
                        <strong>{item.overall}</strong>
                        {item.posPct != null ? <span>긍정 {item.posPct}%</span> : null}
                      </td>
                      <td>
                        {item.recordId ? (
                          <div className="satisfaction-link-cell">
                            <select
                              value={chosen}
                              onChange={(event) =>
                                setLinkChoice((prev) => ({ ...prev, [item.recordId]: event.target.value }))
                              }
                            >
                              {item.candidates.map((candidate) => (
                                <option key={candidate.operationId} value={candidate.operationId}>
                                  {candidate.company ? `${candidate.company} / ` : ""}
                                  {candidate.courseName} ({candidate.dates}) · 점수 {candidate.score}
                                </option>
                              ))}
                            </select>
                            <button
                              className="sync-btn sync-btn-apply"
                              type="button"
                              disabled={linking === item.recordId || !chosen}
                              onClick={() => runLink(item.recordId, chosen)}
                            >
                              {linking === item.recordId ? "연결 중…" : "이 운영에 연결"}
                            </button>
                          </div>
                        ) : (
                          <span className="satisfaction-apply-note">record_id 없음 — 시트에서 확인하세요</span>
                        )}
                        {linkNote[item.recordId] ? (
                          <span className="satisfaction-link-note">{linkNote[item.recordId]}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {unmatched.length > 0 ? (
        <section className="table-section">
          <div className="table-header">
            <h2>미매칭 · 연결할 운영을 찾지 못함</h2>
            <span>{unmatched.length}건</span>
          </div>
          <p className="satisfaction-section-note">
            시트에서 코스ID·일정을 고치면 다음 조회 때 자동으로 매칭됩니다. 테스트 행은 시트에서 삭제하세요.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>시트 과정</th>
                  <th>강사</th>
                  <th>일자</th>
                  <th>courseId</th>
                  <th>이유 / 조치</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((item, index) => (
                  <tr key={`u-${index}`}>
                    <td>{item.course}</td>
                    <td>{item.instructor}</td>
                    <td>{item.date}</td>
                    <td>{item.courseId}</td>
                    <td>{item.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {stats && stats.total === 0 && !loading ? (
        <div className="empty-state">
          <strong>시트에서 읽을 데이터가 없어요</strong>
          <p>탭 이름·헤더 행 번호가 맞는지 확인하거나, 아래에서 다른 시트를 불러와 주세요.</p>
        </div>
      ) : null}

      <details className="sheet-lookup">
        <summary>다른 시트에서 불러오기</summary>
        <div className="sheet-lookup-body">
          <label>
            <span>구글 스프레드시트 URL</span>
            <input
              type="text"
              value={spreadsheetUrl}
              onChange={(event) => setSpreadsheetUrl(event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </label>
          <div className="sheet-lookup-row">
            <label>
              <span>탭 이름</span>
              <input type="text" value={tabTitle} onChange={(event) => setTabTitle(event.target.value)} />
            </label>
            <label>
              <span>헤더 행 번호</span>
              <input
                type="number"
                min={1}
                value={headerRowNumber}
                onChange={(event) => setHeaderRowNumber(Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
          </div>
          <div>
            <button
              className="sync-btn sync-btn-preview"
              type="button"
              onClick={runPreview}
              disabled={loading || spreadsheetUrl.trim() === ""}
            >
              {loading ? "매칭 중…" : "이 시트로 미리보기"}
            </button>
          </div>
        </div>
      </details>
    </>
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
