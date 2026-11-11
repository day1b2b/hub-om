import { coachEngagementEduType, formatEduTime } from "@/lib/coaches/coachEngagementEduType";
import type { CoachEngagementView } from "@/lib/data/coachTypes";

// 투입 한 건의 교육 유형 한 줄. 상세(근무 이력)와 표 보기가 같은 문구를 쓴다.
export function CoachEngagementEduTypeLabel({ engagement }: { engagement: CoachEngagementView }) {
  const eduType = coachEngagementEduType(engagement);
  if (!eduType.linked) {
    return (
      <small className="coach-engagement-edutype is-empty" title="운영현황 회차와 연결되지 않은 투입입니다.">
        유형 정보 없음
      </small>
    );
  }

  const { time } = eduType;
  return (
    <small className="coach-engagement-edutype">
      <span className="coach-engagement-edutype-format">{eduType.formatLabel}</span>
      {time ? (
        <span title={time.source === "engagement" ? "회차 시간이 비어 있어 코치 투입 시간으로 계산했습니다." : "운영현황 회차 시간 기준(쉬는 시간 포함)"}>
          {formatEduTime(time)}
          {time.source === "engagement" ? " (투입 시간)" : ""}
        </span>
      ) : (
        <span>시간 정보 없음</span>
      )}
    </small>
  );
}
