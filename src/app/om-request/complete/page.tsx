import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { getOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function Field({ label, value, wide }: { label: string; value?: string | number; wide?: boolean }) {
  return (
    <label className={wide ? "wide-field" : ""}>
      <span>{label}</span>
      <div className="om-confirm-field">{value || "-"}</div>
    </label>
  );
}

function Badge({ value }: { value: string }) {
  return (
    <label>
      <span style={{ visibility: "hidden" }}>_</span>
      <div className={`om-confirm-field om-badge-field ${value === "Y" ? "om-badge-y" : "om-badge-n"}`}>{value}</div>
    </label>
  );
}

export default async function OmRequestCompletePage({ searchParams }: Props) {
  const params = await searchParams;
  const id = typeof params.id === "string" ? params.id : null;
  const request = id ? getOmRequest(id) : null;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="OM 배정 요청" teamScope="both" />
      <section className="content operations-page operation-create-page">
        <header className="page-header operation-create-header">
          <div className="om-complete-header-inner">
            <div className="om-complete-icon">✓</div>
            <div>
              <h1>요청이 접수되었습니다</h1>
              <p className="page-subtitle">담당자가 확인 후 OM을 배정해드립니다.</p>
            </div>
          </div>
        </header>

        {request && (
          <div className="operation-form">

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
              <div className="section-title"><h2>셋팅 및 운영</h2></div>
              <div className="operation-form-grid">
                <Field label="스킬플로 셋팅" value={request.skillfloSetup} />
                <Field label="스킬매치 셋팅" value={request.skillmatchSetup} />
                <Field label="현장 운영" value={request.onSiteOperation} />
                <Field label="실습 코치 요청" value={request.coachRequest} />
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
                    <span>{s.date}</span>
                    <span>{s.timeStart}</span>
                    <span>{s.timeEnd}</span>
                    <span>{s.duration || "-"}</span>
                    <span className="om-session-location">{s.location}</span>
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

          </div>
        )}

        <div className="om-complete-actions">
          <Link className="primary-link" href="/om-request">새 요청 제출</Link>
          <Link className="secondary-link" href="/dashboard">대시보드로 이동</Link>
        </div>

      </section>
    </main>
  );
}
