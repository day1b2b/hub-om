import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import type { CoachEngagementStatusValue, CoachEngagementView } from "@/lib/data/coachTypes";

const STATUS_LABEL: Record<CoachEngagementStatusValue, string> = {
  scheduled: "예정",
  in_progress: "진행중",
  completed: "완료",
  cancelled: "취소"
};

const STATUS_CLASS: Record<CoachEngagementStatusValue, string> = {
  scheduled: "planned-assignment",
  in_progress: "active",
  completed: "done",
  cancelled: "needs-assignment"
};

interface EngagementFeedback {
  feedback: string | null;
  hiredByText: string | null;
}

interface CoachEngagementListProps {
  coachId: string;
  coachName: string;
  engagements: CoachEngagementView[];
  feedbackByEngagement: Record<string, EngagementFeedback>;
}

export function CoachEngagementList({
  coachId,
  coachName,
  engagements,
  feedbackByEngagement
}: CoachEngagementListProps) {
  const showFeedback = Object.keys(feedbackByEngagement).length > 0;
  const colSpan = showFeedback ? 8 : 6;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Coach engagements" teamScope="both" />

      <section className="content operations-page" id="coach-engagements">
        <header className="page-header">
          <div>
            <p className="eyebrow">코치 DB</p>
            <h1>{coachName} 투입이력</h1>
            <p className="lede">운영에 연결된 투입은 운영 상세로 이동할 수 있습니다.</p>
          </div>
          <div className="header-panel">
            <span>투입 건수</span>
            <strong>{engagements.length}건</strong>
          </div>
        </header>

        <section className="filter-panel operations-filter-panel" aria-label="이동">
          <Link className="course-link" href={`/coaches/${coachId}`}>
            <strong>← 코치 상세로</strong>
          </Link>
        </section>

        <section className="dashboard-panel operations-list-panel">
          <div className="section-title">
            <h2>투입이력</h2>
            <div className="dashboard-table-meta">
              <span>{engagements.length}건</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>과정</th>
                  <th>상태</th>
                  <th>기간</th>
                  <th>평점</th>
                  <th>재투입</th>
                  {showFeedback ? <th>섭외</th> : null}
                  {showFeedback ? <th>피드백</th> : null}
                </tr>
              </thead>
              <tbody>
                {engagements.length > 0 ? (
                  engagements.map((engagement, index) => {
                    const feedback = feedbackByEngagement[engagement.id];
                    return (
                      <tr key={engagement.id}>
                        <td>{index + 1}</td>
                        <td>
                          {engagement.operationSessionId ? (
                            <Link className="course-link" href={`/operations/${engagement.operationSessionId}`}>
                              <strong>{engagement.courseName || "과정명 미상"}</strong>
                            </Link>
                          ) : (
                            <span>
                              <strong>{engagement.courseName || "과정명 미상"}</strong>{" "}
                              <span className="status needs-assignment">운영 미연결</span>
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`status ${STATUS_CLASS[engagement.status]}`}>
                            {STATUS_LABEL[engagement.status]}
                          </span>
                        </td>
                        <td>
                          {engagement.startDate}
                          {engagement.endDate ? ` ~ ${engagement.endDate}` : ""}
                        </td>
                        <td>{engagement.rating ?? "-"}</td>
                        <td>{engagement.rehire === null ? "-" : engagement.rehire ? "예" : "아니오"}</td>
                        {showFeedback ? <td>{feedback?.hiredByText || "-"}</td> : null}
                        {showFeedback ? <td>{feedback?.feedback || "-"}</td> : null}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={colSpan}>
                      <strong>투입이력이 없습니다.</strong>
                      <span>이 코치에 연결된 투입 데이터가 아직 없습니다.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
