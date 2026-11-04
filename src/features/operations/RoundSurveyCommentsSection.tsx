import type { CourseStage } from "./courseStage";
import type { RoundSurveyCommentRow } from "./roundSurveyComments";

// 운영 회차 상세: 회차마다 수강생 코멘트(AI 요약 네 갈래)와 응답자 수·긍정률.
// 주관식 없는 설문은 정상이라 미완성처럼 보이지 않게 안내만 한다.
// 값은 OM이 만족도 분석 앱에서 [hub-om 반영]을 누를 때, 과정코드·날짜·강사가 맞는 회차 하나에 들어온다
// (round-apply). 그래서 교육 전에는 무엇이 언제 채워지는지 안내하고, 끝난 회차는 "반영 대기"로 보여 준다.
export function RoundSurveyCommentsSection({
  rows,
  pendingLabels,
  stage
}: {
  rows: RoundSurveyCommentRow[];
  /** 끝났는데 아직 반영되지 않은 회차 이름(회차 목록 순서). */
  pendingLabels: string[];
  stage: CourseStage;
}) {
  const focused = stage === "review";
  return (
    <section className={`detail-section wide-detail-section round-survey-section${focused ? " stage-focus" : ""}`}>
      <div className="section-title">
        <h2>수강생 코멘트</h2>
        <span className={`stage-badge ${focused ? "stage-badge--now" : "stage-badge--wait"}`}>{focused ? "회고" : "교육 후"}</span>
      </div>
      {rows.length === 0 && pendingLabels.length === 0 ? (
        <p className="field-hint">
          교육이 끝나고 만족도 분석 앱 마이페이지에서 [hub-om 반영]을 누르면, 과정코드·날짜·강사가 맞는 회차에
          응답 수·만족도·수강생 코멘트 요약(👍 좋았던 점 · 🔧 강사 개선 · 🏢 운영·환경 보완 · ➕ 후속 니즈)이 들어와요.
        </p>
      ) : null}
      {pendingLabels.length > 0 ? (
        <>
          <ul className="round-survey-list">
            {pendingLabels.map((label) => (
              <li key={label}>
                <div className="round-survey-head">
                  <strong>{label}</strong>
                  <span className="td-muted">반영 대기 · 만족도 분석 앱에서 이 회차의 설문을 반영해 주세요</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="field-hint">과정코드·강사·강의일정이 비어 있거나 같은 날 비슷한 회차가 여럿이면 들어오지 않아요.</p>
        </>
      ) : null}
      {rows.length > 0 ? (
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
      ) : null}
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
