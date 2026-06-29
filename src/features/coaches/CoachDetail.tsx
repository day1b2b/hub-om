import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import type {
  CoachDetail,
  CoachEngagementStatusValue,
  CoachEngagementView,
  CoachPrivateProfileView,
  CoachScheduleView,
  CoachStatusValue
} from "@/lib/data/coachTypes";

export type CoachDetailTab = "profile" | "schedule" | "engagements";

const STATUS_LABEL: Record<CoachStatusValue, string> = {
  active: "활성",
  pending: "대기",
  inactive: "비활성"
};

const STATUS_CLASS: Record<CoachStatusValue, string> = {
  active: "active",
  pending: "planned-assignment",
  inactive: "needs-assignment"
};

const ENGAGEMENT_STATUS_LABEL: Record<CoachEngagementStatusValue, string> = {
  scheduled: "예정",
  in_progress: "진행",
  completed: "완료",
  cancelled: "취소"
};

const ENGAGEMENT_STATUS_CLASS: Record<CoachEngagementStatusValue, string> = {
  scheduled: "planned-assignment",
  in_progress: "active",
  completed: "done",
  cancelled: "needs-assignment"
};

interface CoachDetailViewProps {
  coach: CoachDetail;
  engagements: CoachEngagementView[];
  privateProfile: CoachPrivateProfileView | null;
  schedules: CoachScheduleView[];
  selectedTab: CoachDetailTab;
}

const DETAIL_TABS: Array<{ href: string; label: string; value: CoachDetailTab }> = [
  { href: "?tab=profile", label: "프로필", value: "profile" },
  { href: "?tab=schedule", label: "스케줄", value: "schedule" },
  { href: "?tab=engagements", label: "근무 이력", value: "engagements" }
];

export function CoachDetailView({
  coach,
  engagements,
  privateProfile,
  schedules,
  selectedTab
}: CoachDetailViewProps) {
  return (
    <main className="dashboard-shell">
      <AppSidebar label="Coach detail" teamScope="both" />

      <section className="content operation-detail-content">
        <header className="page-header detail-header">
          <div className="title-row">
            <span className="title-company">코치</span>
            <h1>{coach.name}</h1>
            <span className={`status ${STATUS_CLASS[coach.status]}`}>{STATUS_LABEL[coach.status]}</span>
            <span className="title-course-id">{coach.isActive ? "활동중" : "비활동"}</span>
          </div>
          <div className="detail-header-actions">
            <Link href="/coaches">← 목록</Link>
          </div>
        </header>

        <nav className="coach-detail-tabs" aria-label="코치 상세 탭">
          {DETAIL_TABS.map((tab) => (
            <Link className={selectedTab === tab.value ? "selected" : ""} href={tab.href} key={tab.value}>
              {tab.label}
            </Link>
          ))}
        </nav>

        <section className="detail-layout">
          {selectedTab === "profile" ? (
            <>
              <section className="detail-section compact-info-section">
                <div className="section-title">
                  <h2>기본 정보</h2>
                </div>
                <div className="info-grid">
                  <InfoItem label="이름" value={coach.name} />
                  <InfoItem label="근무유형" value={coach.workType || "미정"} />
                  <InfoItem label="상태" value={STATUS_LABEL[coach.status]} />
                  <InfoItem label="활동 여부" value={coach.isActive ? "활동중" : "비활동"} />
                </div>
              </section>

              <section className="detail-section compact-info-section">
                <div className="section-title">
                  <h2>분야</h2>
                </div>
                <div className="info-grid">
                  <InfoItem label="전문 분야" value={coach.fields.length > 0 ? coach.fields.join(", ") : "등록된 분야 없음"} />
                </div>
              </section>

              <section className="detail-section compact-info-section wide-detail-section">
                <div className="section-title">
                  <h2>담당 커리큘럼</h2>
                  <span>{coach.curriculums.length}건</span>
                </div>
                {coach.curriculums.length > 0 ? (
                  <div className="info-grid">
                    {coach.curriculums.map((curriculum) => (
                      <InfoItem key={curriculum} label="커리큘럼" value={curriculum} />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <strong>등록된 커리큘럼이 없습니다.</strong>
                    <span>커리큘럼 데이터가 동기화되면 표시됩니다.</span>
                  </div>
                )}
              </section>

              {privateProfile ? (
                <section className="detail-section compact-info-section wide-detail-section">
                  <div className="section-title">
                    <h2>개인정보 (관리자 전용)</h2>
                    <span>접근 기록이 남습니다</span>
                  </div>
                  <div className="info-grid">
                    <InfoItem label="사번" value={privateProfile.employeeId || "-"} />
                    <InfoItem label="연락처" value={privateProfile.phone || "-"} />
                    <InfoItem label="이메일" value={privateProfile.email || "-"} />
                    <InfoItem label="생년월일" value={privateProfile.birthDate || "-"} />
                    <InfoItem label="소속" value={privateProfile.affiliation || "-"} />
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {selectedTab === "schedule" ? (
            <section className="detail-section compact-info-section wide-detail-section">
              <div className="section-title">
                <h2>이번 달 스케줄</h2>
                <span>{schedules.length}건</span>
              </div>
              {schedules.length > 0 ? (
                <div className="coach-detail-list">
                  {schedules.map((schedule) => (
                    <div className="coach-detail-row" key={schedule.id}>
                      <strong>{formatDateLabel(schedule.date)}</strong>
                      <span>{schedule.startTime} ~ {schedule.endTime}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <strong>이번 달 등록된 스케줄이 없습니다.</strong>
                  <span>다른 월의 일정은 코치 일정 화면에서 확인하세요.</span>
                </div>
              )}
            </section>
          ) : null}

          {selectedTab === "engagements" ? (
            <section className="detail-section compact-info-section wide-detail-section">
              <div className="section-title">
                <h2>근무 이력</h2>
                <span>{engagements.length}건</span>
              </div>
              {engagements.length > 0 ? (
                <div className="coach-detail-list">
                  {engagements.map((engagement) => (
                    <div className="coach-detail-row coach-detail-row-wide" key={engagement.id}>
                      <div>
                        <strong>{engagement.courseName || "과정명 미상"}</strong>
                        <span>
                          {formatDateLabel(engagement.startDate)}
                          {engagement.endDate ? ` ~ ${formatDateLabel(engagement.endDate)}` : ""}
                        </span>
                      </div>
                      <span className={`status ${ENGAGEMENT_STATUS_CLASS[engagement.status]}`}>
                        {ENGAGEMENT_STATUS_LABEL[engagement.status]}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <strong>등록된 근무 이력이 없습니다.</strong>
                  <span>투입 이력이 동기화되면 표시됩니다.</span>
                </div>
              )}
            </section>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[1]}.${Number(match[2])}.${Number(match[3])}`;
}
