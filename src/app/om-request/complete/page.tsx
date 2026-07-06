import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { getOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OmRequestCompletePage({ searchParams }: Props) {
  const params = await searchParams;
  const id = typeof params.id === "string" ? params.id : null;
  const request = id ? getOmRequest(id) : null;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="OM 배정 요청" teamScope={{ team: null, viewAll: true }} />
      <section className="content operations-page">
        <div className="om-request-complete">
          <h1>요청이 제출되었습니다</h1>
          <p>OM 배정 요청이 접수되었습니다. 담당자가 확인 후 배정해드립니다.</p>

          {request && (
            <div className="om-request-summary">
              <h2>제출 내용 확인</h2>
              <table className="om-summary-table">
                <tbody>
                  <tr><th>팀</th><td>{request.team}</td></tr>
                  <tr><th>LD</th><td>{request.ld}</td></tr>
                  <tr><th>기업명</th><td>{request.company}</td></tr>
                  <tr><th>교육형태</th><td>{request.trainingType}</td></tr>
                  {request.courseId && <tr><th>코스 ID</th><td>{request.courseId}</td></tr>}
                  <tr><th>과정명</th><td>{request.courseName}</td></tr>
                  {request.instructorName && <tr><th>강사명</th><td>{request.instructorName}</td></tr>}
                  <tr><th>싱크업 링크</th><td>{request.syncupLink}</td></tr>
                  {request.driveLink && <tr><th>드라이브 링크</th><td>{request.driveLink}</td></tr>}
                  <tr><th>스킬플로 셋팅</th><td>{request.skillfloSetup}</td></tr>
                  <tr><th>스킬매치 셋팅</th><td>{request.skillmatchSetup}</td></tr>
                  <tr><th>현장 운영</th><td>{request.onSiteOperation}</td></tr>
                  <tr><th>실습 코치 요청</th><td>{request.coachRequest}</td></tr>
                  <tr><th>총 회차</th><td>{request.totalSessions}회</td></tr>
                </tbody>
              </table>

              <h3>교육 일정</h3>
              <table className="om-summary-table">
                <thead>
                  <tr>
                    <th>회차</th>
                    <th>교육일</th>
                    <th>시작</th>
                    <th>종료</th>
                    <th>시수</th>
                    <th>장소</th>
                  </tr>
                </thead>
                <tbody>
                  {request.sessions.map((s, i) => (
                    <tr key={i}>
                      <td>{i + 1}회차</td>
                      <td>{s.date}</td>
                      <td>{s.timeStart}</td>
                      <td>{s.timeEnd}</td>
                      <td>{s.duration || "-"}</td>
                      <td>{s.location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {request.notes && (
                <>
                  <h3>요청사항</h3>
                  <p className="om-summary-notes">{request.notes}</p>
                </>
              )}
            </div>
          )}

          <div className="om-request-complete-actions">
            <Link className="primary-link" href="/om-request">새 요청 제출</Link>
            <Link className="secondary-link" href="/dashboard">대시보드로 이동</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
