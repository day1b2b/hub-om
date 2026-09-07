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

  const busy = loadState === "loading" || applyState === "loading";
  const restorable = plan?.rows.filter((row) => row.restorable) ?? [];

  return (
    <>
      <div className="restore-search">
        <label>
          <span>코스ID</span>
          <input
            disabled={busy}
            maxLength={200}
            onChange={(event) => setCourseId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !busy) void load();
            }}
            placeholder="예: 263102"
            type="text"
            value={courseId}
          />
        </label>
        <button disabled={busy || !courseId.trim()} onClick={() => void load()} type="button">
          {loadState === "loading" ? "조회 중" : "조회"}
        </button>
      </div>

      {error ? <p className="restore-error">{error}</p> : null}

      {plan ? (
        <>
          <section className="restore-block">
            <h2>코스ID {plan.courseId}의 과정 ({plan.companyNames.join(", ") || "기업 미확인"})</h2>
            <p className="restore-hint">
              회차가 없는 과정도 복구 대상이 될 수 있습니다. 아래 원천 과정명과 일치하는 대상만 재사용합니다.
            </p>
            {plan.courses.length === 0 ? (
              <p className="restore-empty">이 코스ID로 등록된 과정이 없습니다.</p>
            ) : (
              <ul className="restore-course-list">
                {plan.courses.map((course) => (
                  <li key={course.id}>
                    <strong>{course.companyName} · {course.courseName}</strong>
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
                  disabled={busy || restorable.length === 0}
                  onClick={() => setSelected(new Set(restorable.slice(0, 100).map((row) => row.operationId)))}
                  type="button"
                >
                  가능한 항목 선택 (최대 100건)
                </button>
                <button disabled={busy || selected.size === 0} onClick={() => setSelected(new Set())} type="button">
                  선택 해제
                </button>
                <button
                  className="restore-apply"
                  disabled={busy || selected.size === 0 || selected.size > 100}
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
                      <th>기업</th>
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
                            aria-label={`${row.companyName} ${row.roundNo}회차 선택 (${row.operationId})`}
                            checked={selected.has(row.operationId)}
                            disabled={busy || !row.restorable}
                            onChange={(event) => toggle(row.operationId, event.target.checked)}
                            type="checkbox"
                          />
                        </td>
                        <td>{row.companyName}</td>
                        <td>{row.roundNo || "-"}</td>
                        <td>
                          {row.startDate}
                          {row.endDate && row.endDate !== row.startDate ? ` ~ ${row.endDate}` : ""}
                        </td>
                        <td>{row.currentCourseName}</td>
                        <td>
                          {row.sourceCourseName ? (
                            <><strong>{row.sourceCourseName}</strong>{row.blockedReason ? <p className="restore-muted">{row.blockedReason}</p> : null}</>
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

  async function load(preserveResult = false, id = courseId) {
    setLoadState("loading");
    setError(null);
    if (!preserveResult) setResult(null);
    setSelected(new Set());

    try {
      const response = await fetch(`/api/admin/course-name-restore?courseId=${encodeURIComponent(id.trim())}`);
      const payload = (await response.json()) as { ok?: boolean; error?: string; plan?: CourseNameRestorePlan };

      if (!response.ok || !payload.ok || !payload.plan) {
        setLoadState("failed");
        setPlan(null);
        setError(preserveResult ? "복구는 완료됐지만 최신 상태 조회에 실패했습니다. 다시 조회해 주세요." : payload.error ?? "조회하지 못했습니다.");
        return;
      }

      setPlan(payload.plan);
      setLoadState("idle");
    } catch {
      setLoadState("failed");
      setPlan(null);
      setError(preserveResult ? "복구는 완료됐지만 최신 상태 조회에 실패했습니다. 다시 조회해 주세요." : "조회하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    }
  }

  async function apply() {
    if (!plan || busy) return;

    setApplyState("loading");
    setError(null);

    try {
      const response = await fetch("/api/admin/course-name-restore", {
        body: JSON.stringify({ courseId: plan.courseId, operationIds: [...selected], snapshot: plan.snapshot }),
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
      await load(true, plan.courseId);
      setApplyState("idle");   // 적용 후 현재 상태를 다시 읽어 화면과 DB를 맞춘다
    } catch {
      setApplyState("failed");
      setPlan(null);
      setSelected(new Set());
      setError("서버 응답을 확인하지 못해 복구 결과를 알 수 없습니다. 다시 조회하여 현재 상태를 확인해 주세요.");
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
