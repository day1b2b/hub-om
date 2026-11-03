import Link from "next/link";
import { PeopleStatusPill } from "@/features/people/PeopleProfile";
import type { InstructorRecommendation } from "@/features/wiki/instructorRecommendation";
import { COURSE_CATEGORY_GROUPS } from "@/lib/data/omRequest/omCourseCategoryOptions";

// 강사 위키 "강사 추천". 섭외할 때 분야(소분류)와 교육일을 골라 후보를 본다(운영 현황 상세에는 두지 않는다).
// 조건은 주소(?minor=&date=)로 받는 GET 폼이라 새 API 없이 서버에서 계산해 그린다.
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
    <details className="detail-section instructor-recommend-panel" open={recommendation !== null}>
      <summary className="section-title">
        <h2>강사 추천</h2>
        <span>분야와 교육일을 고르면 맡았던 강사를 근거와 함께 보여 드려요</span>
      </summary>
      <form action="/instructor-wiki" className="instructor-recommend-form" method="get">
        <label>
          <span>과정 분야</span>
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
          <input defaultValue={date} name="date" type="date" />
        </label>
        <button type="submit">추천 보기</button>
      </form>

      {recommendation ? <RecommendationResult date={date} recommendation={recommendation} /> : null}
    </details>
  );
}

function RecommendationResult({ recommendation, date }: { recommendation: InstructorRecommendation; date: string }) {
  const { candidates, conflicts, excludedAvoidCount, major, minor, needsCategory } = recommendation;
  if (needsCategory) return <p className="field-hint">분야를 골라 주세요.</p>;
  return (
    <div className="instructor-recommend-result">
      <p className="field-hint">
        {minor} · {major}
        {date ? ` · ${date} 일정이 겹치는 강사는 따로 뺐어요` : " · 교육일을 넣으면 그날 일정이 겹치는 강사를 빼 드려요"}
      </p>
      {candidates.length === 0 ? (
        <p className="field-hint">이 분야를 맡았던 강사가 아직 없어요. 아래 목록에서 전문분야로 찾아 주세요.</p>
      ) : (
        <ol className="instructor-candidates">
          {candidates.map((candidate) => (
            <li key={candidate.name}>
              <span className="instructor-candidates-name">
                <Link href={candidate.href}>{candidate.name}</Link>
                <PeopleStatusPill status={candidate.status} />
              </span>
              <span className="instructor-candidates-reason">{candidate.reasons.join(" · ")}</span>
            </li>
          ))}
        </ol>
      )}
      {conflicts.length > 0 ? (
        <p className="field-hint">
          일정이 겹쳐 뺀 강사: {conflicts.map((conflict) => `${conflict.name}(${conflict.date} ${conflict.conflictWith})`).join(", ")}
        </p>
      ) : null}
      {excludedAvoidCount > 0 ? <p className="field-hint">섭외지양 강사 {excludedAvoidCount}명은 후보에서 뺐어요.</p> : null}
    </div>
  );
}
