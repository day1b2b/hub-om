import Link from "next/link";
import type { CoachConflictEntry, CoachRecommendation } from "./coachRecommendation";

// 코치 위키 "코치 추천". 목록 검색줄 옆 버튼으로 연다(강사 위키의 "강사 추천"과 같은 자리·같은 결).
// 교육일·전문분야를 넣고 [추천받기]를 누르면 주소(?date=&field=)로 다시 열려 서버에서 계산해 그린다(새 API 없음).
// 강사 추천 스타일(instructor-recommend-*)을 그대로 재사용한다.
export function CoachRecommendPanel({
  field,
  date,
  fieldOptions,
  recommendation
}: {
  field: string;
  date: string;
  fieldOptions: string[];
  /** 교육일·전문분야를 고르기 전에는 null. */
  recommendation: CoachRecommendation | null;
}) {
  return (
    <section className="instructor-recommend-panel">
      <p className="field-hint">
        교육일을 넣으면 그날 투입 일정이 겹치지 않는 코치 중에서, OM 평가 높은 순(같으면 투입 경험 순)으로 보여 드려요. 전문분야로 좁힐 수도 있어요.
      </p>
      <form action="/coaches" className="instructor-recommend-form" method="get">
        <label>
          <span>교육일</span>
          {/* max가 없으면 브라우저가 연도를 6자리까지 받는다. 연도 4자리로 막는다. */}
          <input defaultValue={date} max="9999-12-31" min="2000-01-01" name="date" type="date" />
        </label>
        <label>
          <span>전문분야</span>
          <select defaultValue={field} name="field">
            <option value="">전체</option>
            {fieldOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <button type="submit">추천받기</button>
      </form>

      {recommendation ? <CoachRecommendationResult date={date} recommendation={recommendation} /> : null}
    </section>
  );
}

function CoachRecommendationResult({ recommendation, date }: { recommendation: CoachRecommendation; date: string }) {
  const { candidates, conflicts, needsInput } = recommendation;
  if (needsInput) return <p className="field-hint">교육일이나 전문분야를 골라 주세요.</p>;
  return (
    <div className="instructor-recommend-result">
      {candidates.length === 0 ? (
        <p className="field-hint">조건에 맞는 코치가 없어요. 아래 목록에서 전문분야로 찾아 주세요.</p>
      ) : (
        <ol className="instructor-recommend-list">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <Link className="instructor-recommend-name" href={candidate.href}>{candidate.name}</Link>
              <span className="instructor-recommend-sep"> : </span>
              <span>{candidate.reasons.join(" · ")}</span>
              <span className="instructor-recommend-sep"> | </span>
              <span>그날 일정 {date ? "없음" : "교육일 미입력"}</span>
            </li>
          ))}
        </ol>
      )}
      {date && conflicts.length > 0 ? (
        <details className="instructor-recommend-conflicts">
          <summary>그날 투입 일정이 있어 뺀 코치 {conflicts.length}명</summary>
          <ul>
            {conflicts.map((conflict) => (
              <li key={conflict.id}>
                <Link href={conflict.href}>{conflict.name}</Link> — {rangeText(conflict)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function rangeText(conflict: CoachConflictEntry): string {
  return conflict.endDate && conflict.endDate !== conflict.date
    ? `${dotDate(conflict.date)}~${dotDate(conflict.endDate)}`
    : dotDate(conflict.date);
}

/** "2026-10-07" → "2026.10.7" */
function dotDate(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${year}.${Number(month)}.${Number(day)}`;
}
