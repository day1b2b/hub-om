"use client";

import Link from "next/link";
import { useState } from "react";
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

        <section className="dashboard-panel">
          <div className="section-title">
            <h2>내 예약</h2>
            <div className="dashboard-table-meta">
              <span>{activeReservations.length}건</span>
            </div>
          </div>
          {activeReservations.length === 0 ? (
            <div className="coach-doc-empty">
              <strong>예약 중인 일정이 없습니다.</strong>
              <span>코치 일정 화면에서 예약하면 여기에 표시됩니다.</span>
            </div>
          ) : (
            <div className="coach-doc-rows">
              {activeReservations.map((reservation) => {
                const key = `${reservation.coachId}__${reservation.date}`;
                const isBusy = cancellingKey === key;
                return (
                  <div className="coach-doc-row my-reservation-row" key={key}>
                    <Link className="coach-doc-identity" href={`/coaches/${reservation.coachId}`}>
                      <span className="coach-doc-icon">{reservation.coachName.slice(0, 1)}</span>
                      <span className="coach-doc-main">
                        <strong>{reservation.coachName}</strong>
                        <small>{reservation.date}</small>
                      </span>
                    </Link>
                    <span className="coach-doc-reserve">
                      <button
                        className="coach-doc-reserve-chip reserved"
                        disabled={isBusy}
                        onClick={() => handleCancel(reservation.coachId, reservation.date)}
                        type="button"
                      >
                        {isBusy ? "취소 중..." : "예약 취소"}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="dashboard-panel">
          <div className="section-title">
            <h2>확정된 과정</h2>
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
            <div className="my-confirmed-course-list">
              {confirmedCourses.map((course) => {
                const key = `${course.courseName}|${course.startDate}|${course.endDate}`;
                const isExpanded = expandedCourse === key;
                return (
                  <div className="my-confirmed-course" key={key}>
                    <button
                      className="my-confirmed-course-header"
                      onClick={() => setExpandedCourse(isExpanded ? null : key)}
                      type="button"
                    >
                      <span className="my-confirmed-course-name">{course.courseName}</span>
                      <span className="my-confirmed-course-period">
                        {course.startDate} ~ {course.endDate}
                      </span>
                      <span className="my-confirmed-course-coaches">
                        {course.coaches.map((c) => c.coachName).join(", ")}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="my-confirmed-course-body">
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch(`/api/engagements/${coach.engagementId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: rating || null, feedback })
      });
      if (response.ok) {
        setSaved(true);
      } else {
        alert("저장하지 못했습니다.");
      }
    } catch {
      alert("저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="my-confirmed-course-coach-row">
      <strong>{coach.coachName}</strong>
      <div className="my-review-rating" role="radiogroup" aria-label={`${coach.coachName} 평점`}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            aria-pressed={rating >= value}
            className={rating >= value ? "filled" : ""}
            key={value}
            onClick={() => {
              setRating(value);
              setSaved(false);
            }}
            type="button"
          >
            ★
          </button>
        ))}
      </div>
      <input
        className="my-review-feedback"
        onChange={(event) => {
          setFeedback(event.target.value);
          setSaved(false);
        }}
        placeholder="한줄평가"
        type="text"
        value={feedback}
      />
      <button className="coach-doc-reserve-chip" disabled={saving} onClick={handleSave} type="button">
        {saving ? "저장 중..." : saved ? "저장됨" : "저장"}
      </button>
    </div>
  );
}
