import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import type { CoachDetail, CoachPrivateProfileView, CoachStatusValue } from "@/lib/data/coachTypes";

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

interface CoachDetailViewProps {
  coach: CoachDetail;
  privateProfile: CoachPrivateProfileView | null;
}

export function CoachDetailView({ coach, privateProfile }: CoachDetailViewProps) {
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
            <Link href={`/coaches/${coach.id}/engagements`}>투입이력</Link>
          </div>
        </header>

        <section className="detail-layout">
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
