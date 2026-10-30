import type { RoundSurveyCommentRow } from "./roundSurveyComments";

// 운영 회차 상세: 회차마다 수강생 코멘트(AI 요약 네 갈래)와 응답자 수·긍정률.
// 주관식 없는 설문은 정상이라 미완성처럼 보이지 않게 안내만 한다.
export function RoundSurveyCommentsSection({ rows }: { rows: RoundSurveyCommentRow[] }) {
  return (
    <section className="detail-section wide-detail-section round-survey-section">
      <div className="section-title">
        <h2>수강생 코멘트</h2>
        <span>만족도 [hub-om 반영] 때 자동</span>
      </div>
      {rows.length === 0 ? (
        <p className="field-hint">
          아직 반영된 만족도가 없어요. OM이 survey_analysis에서 [hub-om 반영]을 누르면 회차별로 채워져요.
        </p>
      ) : (
        <ul className="round-survey-list">
          {rows.map((row) => (
            <li key={row.operationId}>
              <div className="round-survey-head">
                <strong>{row.label}</strong>
                {row.measured ? <span>{row.measured}</span> : null}
                <span className="round-survey-applied">반영 {formatAppliedAt(row.appliedAt)}</span>
              </div>
              {row.status === "ok" ? (
                row.axes.some((axis) => axis.lines.length > 0) ? (
                  <div className="round-survey-axes">
                    {row.axes.map((axis) => (
                      <div key={axis.axis}>
                        <b>{axis.label}</b>
                        {axis.lines.length > 0 ? (
                          <ul>{axis.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
                        ) : (
                          <span className="td-muted">-</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="td-muted">요약에 남길 의견이 없었어요</span>
                )
              ) : row.status === "no_subjective" ? (
                <span className="people-status people-status--dormant">주관식 없는 설문</span>
              ) : row.status === "no_summary" ? (
                <span>
                  <span className="people-flag people-flag--warn">요약 없이 반영</span>{" "}
                  <span className="td-muted">AI 요약을 만든 뒤 다시 반영하면 채워져요</span>
                </span>
              ) : (
                <span className="td-muted">코멘트 없이 반영됨(이전 버전 앱). 다시 반영하면 채워져요</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 반영 시각은 UTC로 저장된다 — 서울 날짜로 "10.30"처럼 보여 준다. */
function formatAppliedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const [month, day] = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(date).split("/");
  return `${month}.${day}`;
}
