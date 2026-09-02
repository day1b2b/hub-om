"use client";

import { useState } from "react";

interface CourseLookup {
  activeSessionCount: number;
  companyName: string;
  courseName: string;
  courseRecordId: string;
  processId: string;
}

interface LookupResponse {
  course?: CourseLookup;
  error?: string;
  ok: boolean;
}

interface DeleteResponse {
  deletedCount?: number;
  error?: string;
  ok: boolean;
}

export function CourseDeletePanel() {
  const [processIdInput, setProcessIdInput] = useState("");
  const [course, setCourse] = useState<CourseLookup | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDeletedCount, setLastDeletedCount] = useState<number | null>(null);

  async function lookup() {
    if (!processIdInput.trim() || isLookingUp) return;

    setIsLookingUp(true);
    setError(null);
    setCourse(null);
    setLastDeletedCount(null);

    const response = await fetch(`/api/admin/courses/lookup?processId=${encodeURIComponent(processIdInput.trim())}`);
    const payload = (await response.json().catch(() => ({ ok: false }))) as LookupResponse;

    if (!response.ok || !payload.ok || !payload.course) {
      setError(payload.error ?? "과정을 조회하지 못했습니다.");
      setIsLookingUp(false);
      return;
    }

    setCourse(payload.course);
    setIsLookingUp(false);
  }

  async function deleteCourse() {
    if (!course || isDeleting) return;
    if (
      !confirm(
        `${course.processId} · ${course.companyName} · ${course.courseName}\n` +
          `이 과정의 활성 회차 ${course.activeSessionCount}건을 전부 삭제(운영 현황에서 제외)합니다. 계속할까요?`
      )
    ) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    const response = await fetch(`/api/admin/courses/${course.courseRecordId}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({ ok: false }))) as DeleteResponse;

    if (!response.ok || !payload.ok || payload.deletedCount === undefined) {
      setError(payload.error ?? "과정 삭제에 실패했습니다.");
      setIsDeleting(false);
      return;
    }

    setLastDeletedCount(payload.deletedCount);
    setCourse(null);
    setProcessIdInput("");
    setIsDeleting(false);
  }

  return (
    <section className="detail-section">
      <div className="section-title">
        <h2>과정 전체 삭제</h2>
        <span>
          과정ID(PRC-000123)로 과정을 찾아, 그 과정의 모든 회차를 소프트 삭제합니다. 운영 현황에서 사라지며, &quot;삭제된 운영
          차수&quot;에서 회차별로 복원할 수 있습니다.
        </span>
      </div>

      <div className="coach-admin-deleted-panel">
        <div className="coach-admin-deleted-toolbar">
          <input
            onChange={(event) => setProcessIdInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") lookup();
            }}
            placeholder="PRC-000533"
            type="text"
            value={processIdInput}
          />
          <div className="coach-admin-deleted-actions">
            <button disabled={!processIdInput.trim() || isLookingUp} onClick={lookup} type="button">
              {isLookingUp ? "조회 중" : "조회"}
            </button>
          </div>
        </div>

        {error ? <div className="coach-origin-empty-panel">{error}</div> : null}

        {course ? (
          <table className="coach-admin-deleted-table">
            <thead>
              <tr>
                <th>과정ID</th>
                <th>기업</th>
                <th>과정명</th>
                <th>활성 회차</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{course.processId}</td>
                <td>{course.companyName}</td>
                <td>{course.courseName}</td>
                <td>{course.activeSessionCount}건</td>
                <td>
                  <button disabled={isDeleting} onClick={deleteCourse} type="button">
                    {isDeleting ? "삭제 중" : "과정 전체 삭제"}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        ) : null}

        {lastDeletedCount !== null ? (
          <div className="coach-origin-empty-panel">방금 회차 {lastDeletedCount}건을 삭제했습니다.</div>
        ) : null}
      </div>
    </section>
  );
}
