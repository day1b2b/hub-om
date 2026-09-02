"use client";

import { useState } from "react";
import type { CourseNameRestorePlan, CourseNameRestoreResult } from "@/lib/data/courseNameRestore";

type LoadState = "failed" | "idle" | "loading";

/**
 * 과정명 되돌리기 화면.
 *
 * 흐름: 코스ID 입력 → 조회(읽기만) → 되돌릴 회차를 눈으로 확인하고 고름 → 되돌리기.
 * 조회와 적용을 갈라놓은 이유는, 운영 데이터를 바꾸기 전에 무엇이 바뀔지 사람이 먼저
 * 보게 하려는 것이다. 값은 원천 적재 기록에서만 가져오므로 화면이 이름을 추측하지 않는다.
 */
export function CourseNameRestorePanel() {
  const [courseId, setCourseId] = useState("");
  const [plan, setPlan] = useState<CourseNameRestorePlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [applyState, setApplyState] = useState<LoadState>("idle");
  const [error, setError] = useState<null | string>(null);
  const [result, setResult] = useState<CourseNameRestoreResult | null>(null);

  const restorable = plan?.rows.filter((row) => row.restorable) ?? [];

  return (
    <>
      <div className="restore-search">
        <label>
          <span>코스ID</span>
          <input
            onChange={(event) => setCourseId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load();
            }}
            placeholder="예: 263102"
            type="text"
            value={courseId}
          />
        </label>
        <button disabled={loadState === "loading" || !courseId.trim()} onClick={() => void load()} type="button">
          {loadState === "loading" ? "조회 중" : "조회"}
        </button>
      </div>

      {error ? <p className="restore-error">{error}</p> : null}

      {plan ? (
        <>
          <section className="restore-block">
            <h2>이 코스ID의 과정 ({plan.companyNames.join(", ") || "기업 미확인"})</h2>
            <p className="restore-hint">
              회차 0개인 과정은 합쳐지기 전 이름이 남은 흔적입니다. 되돌리면 회차가 이쪽으로 돌아갑니다.
            </p>
            {plan.courses.length === 0 ? (
              <p className="restore-empty">이 코스ID로 등록된 과정이 없습니다.</p>
            ) : (
              <ul className="restore-course-list">
                {plan.courses.map((course) => (
                  <li key={course.id}>
                    <strong>{course.courseName}</strong>
                    <span>{course.sessionCount}회차</span>
                    <span className="restore-muted">최근 수정 {formatDateTime(course.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="restore-block">
            <div className="restore-block-head">
              <h2>회차별 되돌리기 ({restorable.length}건 가능 / 전체 {plan.rows.length}건)</h2>
              <div className="restore-actions">
                <button
                  disabled={restorable.length === 0}
                  onClick={() => setSelected(new Set(restorable.map((row) => row.operationId)))}
                  type="button"
                >
                  가능한 것 전부 선택
                </button>
                <button disabled={selected.size === 0} onClick={() => setSelected(new Set())} type="button">
                  선택 해제
                </button>
                <button
                  className="restore-apply"
                  disabled={selected.size === 0 || applyState === "loading"}
                  onClick={() => void apply()}
                  type="button"
                >
                  {applyState === "loading" ? "되돌리는 중" : `선택한 ${selected.size}건 되돌리기`}
                </button>
              </div>
            </div>

            {plan.rows.length === 0 ? (
              <p className="restore-empty">회차가 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table className="restore-table">
                  <thead>
                    <tr>
                      <th>선택</th>
                      <th>회차</th>
                      <th>일정</th>
                      <th>지금 과정명</th>
                      <th>원천 과정명 (되돌릴 값)</th>
                      <th>최근 수정</th>
                      <th>수정한 사람</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((row) => (
                      <tr className={row.restorable ? "" : "restore-blocked"} key={row.operationId}>
                        <td>
                          <input
                            aria-label={`${row.roundNo}회차 선택`}
                            checked={selected.has(row.operationId)}
                            disabled={!row.restorable}
                            onChange={(event) => toggle(row.operationId, event.target.checked)}
                            type="checkbox"
                          />
                        </td>
                        <td>{row.roundNo || "-"}</td>
                        <td>
                          {row.startDate}
                          {row.endDate && row.endDate !== row.startDate ? ` ~ ${row.endDate}` : ""}
                        </td>
                        <td>{row.currentCourseName}</td>
                        <td>
                          {row.sourceCourseName ? (
                            <strong>{row.sourceCourseName}</strong>
                          ) : (
                            <span className="restore-muted">{row.blockedReason}</span>
                          )}
                        </td>
                        <td>{formatDateTime(row.updatedAt)}</td>
                        <td>{row.updatedBy ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {result ? (
        <section className="restore-block">
          <h2>되돌린 결과</h2>
          {result.moved.length === 0 ? (
            <p className="restore-empty">바뀐 회차가 없습니다.</p>
          ) : (
            <ul className="restore-result">
              {result.moved.map((item) => (
                <li key={item.operationId}>
                  <span className="restore-muted">{item.from}</span> → <strong>{item.to}</strong>
                </li>
              ))}
            </ul>
          )}
          {result.skipped.length > 0 ? (
            <ul className="restore-result restore-muted">
              {result.skipped.map((item) => (
                <li key={item.operationId}>
                  {item.operationId} — {item.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );

  function toggle(operationId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(operationId);
      else next.delete(operationId);
      return next;
    });
  }

  async function load() {
    setLoadState("loading");
    setError(null);
    setResult(null);
    setSelected(new Set());

    try {
      const response = await fetch(`/api/admin/course-name-restore?courseId=${encodeURIComponent(courseId.trim())}`);
      const payload = (await response.json()) as { ok?: boolean; error?: string; plan?: CourseNameRestorePlan };

      if (!response.ok || !payload.ok || !payload.plan) {
        setLoadState("failed");
        setPlan(null);
        setError(payload.error ?? "조회하지 못했습니다.");
        return;
      }

      setPlan(payload.plan);
      setLoadState("idle");
    } catch {
      setLoadState("failed");
      setPlan(null);
      setError("조회하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    }
  }

  async function apply() {
    if (!plan) return;

    setApplyState("loading");
    setError(null);

    try {
      const response = await fetch("/api/admin/course-name-restore", {
        body: JSON.stringify({ courseId: plan.courseId, operationIds: [...selected] }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; result?: CourseNameRestoreResult };

      if (!response.ok || !payload.ok || !payload.result) {
        setApplyState("failed");
        setError(payload.error ?? "되돌리지 못했습니다.");
        return;
      }

      setResult(payload.result);
      setApplyState("idle");
      await load();   // 적용 후 현재 상태를 다시 읽어 화면과 DB를 맞춘다
    } catch {
      setApplyState("failed");
      setError("되돌리지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    }
  }
}

/** ISO 문자열을 한국 시간 기준 "MM-DD HH:mm" 으로. 사고 시각을 눈으로 맞추기 위한 표기다. */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul"
  });
}
