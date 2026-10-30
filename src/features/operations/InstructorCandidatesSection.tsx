import Link from "next/link";
import { PeopleStatusPill } from "@/features/people/PeopleProfile";
import type { InstructorRecommendation } from "@/features/wiki/instructorRecommendation";

// 과정 상세 "후보 강사". 보여 주기만 한다. 섭외 요청은 바로 위 계약 요청 칸에서 한다.
export function InstructorCandidatesSection({ recommendation }: { recommendation: InstructorRecommendation }) {
  const { candidates, conflicts, excludedAvoidCount, major, minor, needsCategory } = recommendation;

  return (
    <section className="detail-section instructor-candidates-section" id="instructor-candidates">
      <div className="section-title">
        <h2>후보 강사</h2>
        <span>{needsCategory ? "과정 카테고리 필요" : `${minor} · ${major}`}</span>
      </div>
      {needsCategory ? (
        <p className="field-hint">위 기본 정보의 &quot;과정 카테고리 소분류&quot;를 정하면, 같은 분야 과정을 맡았던 강사를 근거와 함께 보여 드려요.</p>
      ) : candidates.length === 0 ? (
        <p className="field-hint">이 분야를 맡았던 강사가 아직 없어요. 강사 위키에서 분야로 찾아 주세요.</p>
      ) : (
        <ol className="instructor-candidates">
          {candidates.map((candidate) => (
            <li key={candidate.name}>
              <span className="instructor-candidates-name">
                <Link href={candidate.href} rel="noreferrer" target="_blank">{candidate.name} ↗</Link>
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
    </section>
  );
}
