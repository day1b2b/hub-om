"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { MyActiveReservation, MyConfirmedCourse } from "@/lib/data/coachMyPage";

interface CoachMyPageProps {
  reservations: MyActiveReservation[];
  inProgressCourses: MyConfirmedCourse[];
  pastCourses: MyConfirmedCourse[];
  todayIso: string;
}

export function CoachMyPage({ reservations, inProgressCourses, pastCourses, todayIso }: CoachMyPageProps) {
  const [activeReservations, setActiveReservations] = useState(reservations);
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);

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
        <header className="coach-workspace-header">
          <div>
            <h1>마이페이지</h1>
            <span className="coach-plan-badge">coach-db</span>
          </div>
        </header>

        <div className="my-page-two-col">
          <section className="dashboard-panel my-reservation-panel">
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
              <div className="my-reservation-card-list">
                {activeReservations.map((reservation) => {
                  const key = `${reservation.coachId}__${reservation.date}`;
                  const isBusy = cancellingKey === key;
                  return (
                    <div className="my-reservation-card" key={key}>
                      <Link className="my-reservation-identity" href={`/coaches/${reservation.coachId}`}>
                        <strong>{reservation.coachName}</strong>
                        <span>{reservation.date}</span>
                      </Link>
                      <button
                        className="my-reservation-cancel"
                        disabled={isBusy}
                        onClick={() => handleCancel(reservation.coachId, reservation.date)}
                        type="button"
                      >
                        {isBusy ? "취소 중..." : "취소"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <CourseCardSection
            courses={inProgressCourses}
            emptyText={{ title: "진행중인 과정이 없습니다.", hint: "예약한 코치의 투입이 확정되면 여기에 표시됩니다." }}
            title="진행중 과정"
            todayIso={todayIso}
          />
        </div>

        <CourseCardSection
          courses={pastCourses}
          emptyText={{ title: "지난 과정이 아직 없습니다.", hint: "진행중 과정의 기간이 지나면 자동으로 여기로 옮겨집니다." }}
          title="지난 과정"
          todayIso={todayIso}
        />
      </section>
    </main>
  );
}

interface CourseCardSectionProps {
  courses: MyConfirmedCourse[];
  emptyText: { title: string; hint: string };
  title: string;
  todayIso: string;
}

function CourseCardSection({ courses, emptyText, title, todayIso }: CourseCardSectionProps) {
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);

  return (
    <section className="dashboard-panel">
      <div className="section-title">
        <h2>{title}</h2>
        <div className="dashboard-table-meta">
          <span>{courses.length}건</span>
        </div>
      </div>
      {courses.length === 0 ? (
        <div className="coach-doc-empty">
          <strong>{emptyText.title}</strong>
          <span>{emptyText.hint}</span>
        </div>
      ) : (
        <div className="my-course-card-list">
          {courses.map((course) => {
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
                      <CoachReviewRow coach={coach} key={coach.engagementId} todayIso={todayIso} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface CoachReviewRowProps {
  coach: MyConfirmedCourse["coaches"][number];
  todayIso: string;
}

function CoachReviewRow({ coach, todayIso }: CoachReviewRowProps) {
  const router = useRouter();
  const [rating, setRating] = useState(coach.rating ?? 0);
  const [feedback, setFeedback] = useState(coach.feedback ?? "");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 별점만 눌러도, 한줄평가 없이도 저장 가능 — 둘 다 그대로 현재 값을 보낸다.
  async function handleSave() {
    setSaving(true);
    try {
      const response = await fetch(`/api/engagements/${coach.engagementId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: rating || null, feedback })
      });
      if (response.ok) {
        setJustSaved(true);
        if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
        savedFlashTimer.current = setTimeout(() => setJustSaved(false), 1500);
        // 카드를 접었다 펼치면 이 값으로 다시 초기화되므로, 서버 데이터도 최신으로 맞춰둔다.
        router.refresh();
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
              onClick={() => setRating(rating === value ? 0 : value)}
              type="button"
            >
              {rating >= value ? "★" : "☆"}
            </button>
          ))}
        </div>
        <input
          className="my-review-feedback"
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="한줄 평가"
          type="text"
          value={feedback}
        />
        <span className={`my-review-saved-flash${justSaved ? " visible" : ""}`} aria-live="polite">
          {justSaved ? "저장됨" : ""}
        </span>
        <button className="my-review-save" disabled={saving} onClick={handleSave} type="button">
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      {coach.rounds.length > 0 && (
        <div className="my-round-list">
          {coach.rounds.map((round) => {
            // 회차 자체는 어제까지 지났으면 과정 전체 상태(진행중)와 무관하게 완료로 표시한다.
            const roundLabel = round.date < todayIso ? "완료" : coach.statusLabel;
            return (
              <div className="my-round-row" key={`${round.date}-${round.startTime}`}>
                <span className="my-round-label">회차</span>
                <span>
                  {round.date} {round.startTime}~{round.endTime}
                </span>
                <span className={`status ${roundLabel === "완료" ? "done" : "active"}`}>{roundLabel}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
