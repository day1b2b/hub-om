"use client";

import { type CSSProperties, useEffect, useState } from "react";

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
  course: string;
  instructor: string;
  date: string;
  candidates: Array<{ courseName: string; company: string; dates: string; score: number }>;
}

interface UnmatchedItem {
  course: string;
  instructor: string;
  date: string;
  courseId: string;
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

export function SatisfactionMatchPreview() {
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const [tabTitle, setTabTitle] = useState("eduops_log");
  const [headerRowNumber, setHeaderRowNumber] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reauthRequired, setReauthRequired] = useState(false);
  const [data, setData] = useState<PreviewResponse | null>(null);

  async function runPreview() {
    setLoading(true);
    setError("");
    setReauthRequired(false);
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
    void runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = data?.stats;

  return (
    <main className="preview-shell" style={{ padding: "24px", maxWidth: "1100px", margin: "0 auto" }}>
      <header style={{ marginBottom: "16px" }}>
        <h1 style={{ margin: "0 0 8px" }}>만족도 매칭 미리보기</h1>
        <p style={{ color: "#555", margin: 0 }}>
          화면을 열면 팀 집계 시트를 자동으로 읽어 최신 매칭 상태를 보여줍니다. 조회만 하며 실제
          데이터는 변경하지 않습니다. 미매칭 건은 시트에서 코스ID·일정을 고치면 다음 조회 때 자동으로
          매칭됩니다. (다른 시트를 볼 때만 아래 주소를 직접 입력)
        </p>
      </header>

      <section
        style={{ display: "grid", gap: "12px", padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px" }}
      >
        <label style={{ display: "grid", gap: "4px" }}>
          <span>구글 스프레드시트 URL</span>
          <input
            type="text"
            value={spreadsheetUrl}
            onChange={(event) => setSpreadsheetUrl(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }}
          />
        </label>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: "4px" }}>
            <span>탭 이름</span>
            <input
              type="text"
              value={tabTitle}
              onChange={(event) => setTabTitle(event.target.value)}
              style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }}
            />
          </label>
          <label style={{ display: "grid", gap: "4px" }}>
            <span>헤더 행 번호</span>
            <input
              type="number"
              min={1}
              value={headerRowNumber}
              onChange={(event) => setHeaderRowNumber(Math.max(1, Number(event.target.value) || 1))}
              style={{ padding: "8px", width: "120px", border: "1px solid #d1d5db", borderRadius: "6px" }}
            />
          </label>
        </div>
        <div>
          <button
            type="button"
            onClick={runPreview}
            disabled={loading || spreadsheetUrl.trim() === ""}
            style={{
              padding: "10px 18px",
              borderRadius: "6px",
              border: "none",
              background: loading ? "#9ca3af" : "#2563eb",
              color: "#fff",
              cursor: loading ? "default" : "pointer"
            }}
          >
            {loading ? "매칭 중..." : "미리보기 실행"}
          </button>
        </div>
      </section>

      {error ? (
        <p style={{ color: "#b91c1c", marginTop: "16px" }}>
          {error}
          {reauthRequired ? (
            <>
              {" "}
              <a href="/sign-in?reauth=google&callbackUrl=/admin/satisfaction-preview">Google 권한 다시 받기</a>
            </>
          ) : null}
        </p>
      ) : null}

      {stats ? (
        <p style={{ marginTop: "20px", fontWeight: 600 }}>
          시트 {stats.total}행 · 운영 {stats.operations}건 →{" "}
          <span style={{ color: "#15803d" }}>자동연결 {stats.matched}</span> ·{" "}
          <span style={{ color: "#b45309" }}>모호 {stats.ambiguous}</span> ·{" "}
          <span style={{ color: "#b91c1c" }}>미매칭 {stats.unmatched}</span>
        </p>
      ) : null}

      {data?.matched && data.matched.length > 0 ? (
        <section style={{ marginTop: "16px" }}>
          <h2 style={{ fontSize: "16px" }}>자동 연결 가능</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>시트 과정</th>
                  <th style={thStyle}>강사</th>
                  <th style={thStyle}>일자</th>
                  <th style={thStyle}>만족도</th>
                  <th style={thStyle}>연결될 운영</th>
                  <th style={thStyle}>운영 일정</th>
                  <th style={thStyle}>현재값</th>
                </tr>
              </thead>
              <tbody>
                {data.matched.map((item, index) => (
                  <tr key={`m-${index}`}>
                    <td style={tdStyle}>{item.course}</td>
                    <td style={tdStyle}>{item.instructor}</td>
                    <td style={tdStyle}>{item.date}</td>
                    <td style={tdStyle}>
                      {item.overall}
                      {item.posPct != null ? ` (긍정 ${item.posPct}%)` : ""}
                    </td>
                    <td style={tdStyle}>
                      {item.operationCompany ? `${item.operationCompany} / ` : ""}
                      {item.operationCourse}
                    </td>
                    <td style={tdStyle}>{item.operationDates}</td>
                    <td style={tdStyle}>{item.currentSatisfaction || "미입력"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data?.ambiguous && data.ambiguous.length > 0 ? (
        <section style={{ marginTop: "16px" }}>
          <h2 style={{ fontSize: "16px" }}>모호 (수동 확인 필요)</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>시트 과정</th>
                  <th style={thStyle}>강사</th>
                  <th style={thStyle}>일자</th>
                  <th style={thStyle}>후보들</th>
                </tr>
              </thead>
              <tbody>
                {data.ambiguous.map((item, index) => (
                  <tr key={`a-${index}`}>
                    <td style={tdStyle}>{item.course}</td>
                    <td style={tdStyle}>{item.instructor}</td>
                    <td style={tdStyle}>{item.date}</td>
                    <td style={tdStyle}>
                      {item.candidates
                        .map((candidate) => `${candidate.courseName} (${candidate.dates}, ${candidate.score})`)
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data?.unmatched && data.unmatched.length > 0 ? (
        <section style={{ marginTop: "16px" }}>
          <h2 style={{ fontSize: "16px" }}>미매칭 (후보 없음)</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>시트 과정</th>
                  <th style={thStyle}>강사</th>
                  <th style={thStyle}>일자</th>
                  <th style={thStyle}>courseId</th>
                </tr>
              </thead>
              <tbody>
                {data.unmatched.map((item, index) => (
                  <tr key={`u-${index}`}>
                    <td style={tdStyle}>{item.course}</td>
                    <td style={tdStyle}>{item.instructor}</td>
                    <td style={tdStyle}>{item.date}</td>
                    <td style={tdStyle}>{item.courseId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}

const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", fontSize: "13px" };
const thStyle: CSSProperties = {
  textAlign: "left",
  borderBottom: "2px solid #e5e7eb",
  padding: "6px 8px",
  whiteSpace: "nowrap"
};
const tdStyle: CSSProperties = { borderBottom: "1px solid #f1f5f9", padding: "6px 8px" };
