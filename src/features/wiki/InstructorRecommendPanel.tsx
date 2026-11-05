import Link from "next/link";
import type { InstructorCandidate, InstructorConflict, InstructorRecommendation } from "@/features/wiki/instructorRecommendation";
import type { PeopleStatus } from "@/lib/people/peopleStatus";
import { COURSE_CATEGORY_GROUPS } from "@/lib/data/omRequest/omCourseCategoryOptions";

// 강사 위키 "강사 추천". 목록 검색줄 옆 버튼으로 연다(운영 현황 상세에는 두지 않는다).
// 분야(소분류)·교육일을 넣고 [추천받기]를 누르면 주소(?minor=&date=)로 다시 열려 서버에서 계산해 그린다(새 API 없음).
// 결과는 한 줄에 한 강사: "1. 이름 : 이 분야 경험 | 강사 만족도 | 그날 일정 | 상태".

const STATUS_TEXT: Record<PeopleStatus, string> = {
  booked: "예정 과정 있음",
  active: "활동",
  dormant: "휴면",
  never: "투입 이력 없음"
};

export function InstructorRecommendPanel({
  minor,
  date,
  recommendation
}: {
  minor: string;
  date: string;
  /** 분야를 고르기 전에는 null. */
  recommendation: InstructorRecommendation | null;
}) {
  return (
    <section className="instructor-recommend-panel">
      <p className="field-hint">
        그날 운영 현황에 일정이 잡히지 않은 강사 중에서, 이 분야를 많이 맡은 순(같으면 강사 만족도 순)으로 보여 드려요.
      </p>
      <form action="/instructor-wiki" className="instructor-recommend-form" method="get">
        <label>
          <span>분야</span>
          <select defaultValue={minor} name="minor" required>
            <option value="">소분류 선택</option>
            {COURSE_CATEGORY_GROUPS.map((group) => (
              <optgroup key={group.major} label={group.major}>
                {group.minors.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          <span>교육일</span>
          {/* max가 없으면 브라우저가 연도를 6자리까지 받는다. 연도 4자리로 막는다. */}
          <input defaultValue={date} max="9999-12-31" min="2000-01-01" name="date" type="date" />
        </label>
        <button type="submit">추천받기</button>
      </form>

      {recommendation ? <RecommendationResult date={date} recommendation={recommendation} /> : null}
    </section>
  );
}

function RecommendationResult({ recommendation, date }: { recommendation: InstructorRecommendation; date: string }) {
  const { candidates, conflicts, excludedAvoidCount, major, needsCategory } = recommendation;
  if (needsCategory) return <p className="field-hint">분야를 골라 주세요.</p>;
  return (
    <div className="instructor-recommend-result">
      {candidates.length === 0 ? (
        <p className="field-hint">이 분야를 맡았던 강사가 아직 없어요. 아래 목록에서 전문분야로 찾아 주세요.</p>
      ) : (
        <ol className="instructor-recommend-list">
          {candidates.map((candidate) => (
            <li key={candidate.name}>
              <Link className="instructor-recommend-name" href={candidate.href}>{candidate.name}</Link>
              <span className="instructor-recommend-sep"> : </span>
              <span>이 분야 경험 {experienceText(candidate, major)}</span>
              <span className="instructor-recommend-sep"> | </span>
              <span>강사 만족도 {candidate.satisfaction !== null ? candidate.satisfaction.toFixed(1) : "-"}</span>
              <span className="instructor-recommend-sep"> | </span>
              <span>그날 일정 {date ? "없음" : "교육일 미입력"}</span>
              <span className="instructor-recommend-sep"> | </span>
              <span>상태 {STATUS_TEXT[candidate.status]}</span>
            </li>
          ))}
        </ol>
      )}
      {date && conflicts.length > 0 ? (
        <details className="instructor-recommend-conflicts">
          <summary>그날 다른 일정이 있어 뺀 강사 {conflicts.length}명</summary>
          <ul>
            {conflicts.map((conflict) => (
              <li key={conflict.name}>
                <Link href={conflict.href}>{conflict.name}</Link> — {conflict.conflictWith} ({rangeText(conflict)})
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {excludedAvoidCount > 0 ? <p className="field-hint">섭외지양 강사 {excludedAvoidCount}명은 뺐어요.</p> : null}
    </div>
  );
}

/** "30회차 · 마지막 2026.10.7". 같은 소분류가 없으면 대분류 경험, 그것도 없으면 노션 분야만 맞는 강사다. */
function experienceText(candidate: InstructorCandidate, major: string): string {
  const last = candidate.lastDate ? ` · 마지막 ${dotDate(candidate.lastDate)}` : "";
  if (candidate.sameMinorCount > 0) return `${candidate.sameMinorCount}회차${last}`;
  if (candidate.sameMajorCount > 0) return `0회차 (같은 대분류 ${major} ${candidate.sameMajorCount}회차)${last}`;
  return "0회차 (노션 전문분야만 일치)";
}

function rangeText(conflict: InstructorConflict): string {
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
