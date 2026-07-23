"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { MyActiveReservation, MyConfirmedCourse } from "@/lib/data/coachMyPage";

interface CoachMyPageProps {
  reservations: MyActiveReservation[];
  confirmedCourses: MyConfirmedCourse[];
}

export function CoachMyPage({ reservations, confirmedCourses }: CoachMyPageProps) {
  const [activeReservations, setActiveReservations] = useState(reservations);
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);

  async function handleCancel(coachId: string, date: string) {
    if (!confirm("예약을 취소하시겠습니까?")) return;
    const key = `${coachId}__${date}`;
    setCancellingKey(key);
    try {
      const response = await fetch(`/api/coaches/${coachId}/reservations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates: [date] })
      });
      if (response.ok) {
        setActiveReservations((prev) => prev.filter((r) => !(r.coachId === coachId && r.date === date)));
      } else {
        alert("취소하지 못했습니다.");
      }
    } catch {
      alert("취소하지 못했습니다.");
    } finally {
      setCancellingKey(null);
    }
  }

  return (
    <main className="dashboard-shell coach-schedule-shell">
      <AppSidebar label="My coach page" teamScope="both" />

      <section className="content coach-schedule-workspace" id="coach-my-page">
        <div className="coach-schedule-topbar">
          <div className="coach-schedule-topnav">
            <Link href="/coaches/schedule">코치 일정</Link>
            <Link href="/coaches">코치 목록</Link>
          </div>
        </div>

        <header className="coach-workspace-header">
          <div>
            <h1>마이페이지</h1>
            <span className="coach-plan-badge">hub-om</span>
          </div>
        </header>

        <section className="dashboard-panel operations-list-panel">
          <div className="section-title">
            <h2>내 예약</h2>
            <div className="dashboard-table-meta">
              <span>{activeReservations.length}건</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="my-page-table">
              <thead>
                <tr>
                  <th>코치</th>
                  <th>날짜</th>
                  <th aria-label="취소" />
                </tr>
              </thead>
              <tbody>
                {activeReservations.length > 0 ? (
                  activeReservations.map((reservation) => {
                    const key = `${reservation.coachId}__${reservation.date}`;
                    const isBusy = cancellingKey === key;
                    return (
                      <tr key={key}>
                        <td>
                          <Link className="course-link" href={`/coaches/${reservation.coachId}`}>
                            <strong>{reservation.coachName}</strong>
                          </Link>
                        </td>
                        <td>{reservation.date}</td>
                        <td className="my-page-table-action">
                          <button
                            className="my-page-cancel-link"
                            disabled={isBusy}
                            onClick={() => handleCancel(reservation.coachId, reservation.date)}
                            type="button"
                          >
                            {isBusy ? "취소 중..." : "예약 취소"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={3}>
                      <strong>예약 중인 일정이 없습니다.</strong>
                      <span>코치 일정 화면에서 예약하면 여기에 표시됩니다.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="section-title">
            <h2>지난 과정</h2>
            <div className="dashboard-table-meta">
              <span>{confirmedCourses.length}건</span>
            </div>
          </div>
          {confirmedCourses.length === 0 ? (
            <div className="coach-doc-empty">
              <strong>확정된 과정이 아직 없습니다.</strong>
              <span>예약한 코치의 투입이 확정되면 여기에 표시됩니다.</span>
            </div>
          ) : (
            <div className="my-course-card-list">
              {confirmedCourses.map((course) => {
                const key = course.courseName;
                const isExpanded = expandedCourse === key;
                return (
                  <div className="my-course-card" key={key}>
                    <button
                      className="my-course-card-header"
                      onClick={() => setExpandedCourse(isExpanded ? null : key)}
                      type="button"
                    >
                      <span className="my-course-toggle-icon">{isExpanded ? "▼" : "▶"}</span>
                      <span className="my-course-title">{course.courseName}</span>
                      <span className="my-course-coach-count">코치 {course.coaches.length}명</span>
                      <span className="my-course-period">
                        {course.startDate.slice(0, 7)} ~ {course.endDate.slice(0, 7)}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="my-course-card-body">
                        {course.coaches.map((coach) => (
                          <CoachReviewRow coach={coach} key={coach.engagementId} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

interface CoachReviewRowProps {
  coach: MyConfirmedCourse["coaches"][number];
}

function CoachReviewRow({ coach }: CoachReviewRowProps) {
  const [rating, setRating] = useState(coach.rating ?? 0);
  const [feedback, setFeedback] = useState(coach.feedback ?? "");
  const [rehire, setRehire] = useState(coach.rehire ?? false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function save(next: { rating?: number | null; feedback?: string; rehire?: boolean }) {
    setSaving(true);
    try {
      const response = await fetch(`/api/engagements/${coach.engagementId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      if (response.ok) {
        setJustSaved(true);
        if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
        savedFlashTimer.current = setTimeout(() => setJustSaved(false), 1500);
      } else {
        alert("저장하지 못했습니다.");
      }
    } catch {
      alert("저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function handleFeedbackChange(value: string) {
    setFeedback(value);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    // 타이핑을 멈춘 지 0.6초 뒤 자동 저장(계속 입력 중이면 저장을 미룬다).
    feedbackTimer.current = setTimeout(() => save({ feedback: value }), 600);
  }

  function flushFeedback() {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
      save({ feedback });
    }
  }

  return (
    <div className="my-coach-block">
      <div className="my-coach-block-header">
        <Link className="my-coach-name" href={`/coaches/${coach.coachId}`}>
          {coach.coachName}
        </Link>
        <span className="my-coach-dates">
          {coach.startDate} ~ {coach.endDate}
        </span>
        <span className={`status ${coach.statusLabel === "완료" ? "done" : "active"}`}>{coach.statusLabel}</span>
      </div>

      <div className="my-review-row">
        <div className="my-review-rating" role="radiogroup" aria-label={`${coach.coachName} 평점`}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              aria-pressed={rating >= value}
              disabled={saving}
              key={value}
              onClick={() => {
                const next = rating === value ? 0 : value;
                setRating(next);
                save({ rating: next || null });
              }}
              type="button"
            >
              {rating >= value ? "★" : "☆"}
            </button>
          ))}
        </div>
        <input
          className="my-review-feedback"
          onBlur={flushFeedback}
          onChange={(event) => handleFeedbackChange(event.target.value)}
          placeholder="한줄 평가"
          type="text"
          value={feedback}
        />
        <label className="my-review-rehire">
          <input
            checked={rehire}
            disabled={saving}
            onChange={(event) => {
              setRehire(event.target.checked);
              save({ rehire: event.target.checked });
            }}
            type="checkbox"
          />
          재투입
        </label>
        <span className={`my-review-saved-flash${justSaved ? " visible" : ""}`} aria-live="polite">
          {justSaved ? "저장됨" : ""}
        </span>
      </div>

      {coach.rounds.length > 0 && (
        <div className="my-round-list">
          {coach.rounds.map((round) => (
            <div className="my-round-row" key={`${round.date}-${round.startTime}`}>
              <span className="my-round-label">회차</span>
              <span>
                {round.date} {round.startTime}~{round.endTime}
              </span>
              <span className={`status ${coach.statusLabel === "완료" ? "done" : "active"}`}>{coach.statusLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
