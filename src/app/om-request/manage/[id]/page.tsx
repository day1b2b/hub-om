import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
import { AssignForm } from "./AssignForm";
import { RequestActions } from "./RequestActions";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

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

export default async function OmRequestDetailPage({ params }: Props) {
  await requireWorkspaceSession();
  const { id } = await params;
  const request = getOmRequest(id);
  if (!request) notFound();

  const createdAt = new Date(request.createdAt).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });

  return (
    <main className="dashboard-shell">
      <AppSidebar label="담당 관리" teamScope="both" />
      <section className="content operations-page">

        <header className="page-header">
          <div>
            <div className="detail-breadcrumb">
              <Link href="/om-request/manage">담당 관리</Link>
              <span>›</span>
              <span>{request.company} · {request.courseName}</span>
            </div>
            <h1>{request.courseName}</h1>
            <p className="page-subtitle">{request.company} · {request.team} · 접수 {createdAt}</p>
          </div>
          <RequestActions id={request.id} />
        </header>

        <div className="detail-layout">
          <div className="operation-form">

            <div className="operation-form-section">
              <div className="section-title"><h2>기본 정보</h2></div>
              <div className="operation-form-grid">
                <Field label="구분" value={request.team} />
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

          </div>

          <aside className="detail-sidebar">
            <div className="detail-card">
              <h2>
                OM 배정
                <span className={`om-status-badge ${request.status === "배정필요" ? "need" : "done"}`} style={{ fontSize: 11 }}>
                  {request.status}
                </span>
              </h2>
              <AssignForm request={request} />
            </div>
          </aside>
        </div>

      </section>
    </main>
  );
}
