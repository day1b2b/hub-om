"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";
import { OmRequestForm } from "@/app/om-request/OmRequestForm";

function Field({ label, value, wide }: { label: string; value?: string | number | null; wide?: boolean }) {
  return (
    <label className={wide ? "wide-field" : ""}>
      <span>{label}</span>
      <div className="om-confirm-field">{value || "-"}</div>
    </label>
  );
}

function YNField({ label, value }: { label: string; value: string }) {
  return (
    <label>
      <span>{label}</span>
      <div className={`om-confirm-field om-badge-field ${value === "Y" ? "om-badge-y" : "om-badge-n"}`}>{value}</div>
    </label>
  );
}

export function OmRequestDetailView({ request }: { request: OmRequest }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm("이 요청을 삭제하시겠습니까? 삭제하면 복구할 수 없습니다.")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/om-request/${request.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("삭제에 실패했습니다.");
      router.push("/om-request/manage");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <OmRequestForm
        ldName={request.ld}
        initialRequest={request}
        onCancelEdit={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="operation-form">
      {error && <p className="om-request-error">{error}</p>}

      <div className="operation-form-section">
        <div className="section-title"><h2>기본 정보</h2></div>
        <div className="operation-form-grid">
          <Field label="팀" value={request.team} />
          <Field label="LD" value={request.ld} />
          <Field label="기업명" value={request.company} />
          <Field label="교육형태" value={request.trainingType} />
          <Field label="코스 ID" value={request.courseId} />
          <Field label="과정명" value={request.courseName} />
          <Field label="강사명" value={request.instructorName} />
          <Field wide label="싱크업 링크" value={request.syncupLink} />
          <Field wide label="드라이브 링크" value={request.driveLink} />
        </div>
      </div>

      <div className="operation-form-section">
        <div className="section-title"><h2>세팅 및 운영</h2></div>
        <div className="operation-form-grid">
          <YNField label="스킬플로 세팅" value={request.skillfloSetup} />
          <YNField label="스킬매치 세팅" value={request.skillmatchSetup} />
          <YNField label="현장 운영" value={request.onSiteOperation} />
          <YNField label="실습 코치 요청" value={request.coachRequest} />
        </div>
      </div>

      <div className="operation-form-section">
        <div className="section-title"><h2>교육 일정 · 총 {request.totalSessions}회차</h2></div>
        <div className="om-session-list">
          <div className="om-session-list-header">
            <span>회차</span>
            <span>교육일</span>
            <span>시작</span>
            <span>종료</span>
            <span>시수</span>
            <span>장소</span>
          </div>
          {request.sessions.map((s, i) => (
            <div className="om-session-list-row" key={i}>
              <span className="om-session-num">{i + 1}</span>
              <span>{s.date || "-"}</span>
              <span>{s.timeStart || "-"}</span>
              <span>{s.timeEnd || "-"}</span>
              <span>{s.duration || "-"}</span>
              <span className="om-session-location">{s.location || "-"}</span>
            </div>
          ))}
        </div>
      </div>

      {request.notes && (
        <div className="operation-form-section">
          <div className="section-title"><h2>요청사항</h2></div>
          <div className="operation-form-grid">
            <label className="full-row-field">
              <div className="om-confirm-field om-confirm-notes">{request.notes}</div>
            </label>
          </div>
        </div>
      )}

      <div className="om-detail-actions">
        <button type="button" className="secondary-action" onClick={() => setEditing(true)}>
          수정
        </button>
        <button type="button" className="secondary-action om-detail-delete-action" disabled={deleting} onClick={handleDelete}>
          {deleting ? "삭제 중..." : "삭제"}
        </button>
      </div>
    </div>
  );
}
