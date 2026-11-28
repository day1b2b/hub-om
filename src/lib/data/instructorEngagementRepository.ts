// 강사위키 투입현황 읽기 경계. 코치 CoachRepository.listEngagements 대응(강사판).
// 강사 투입엔 코치의 rating/rehire/feedback가 없다(평가 모델 후속). status 값·linkedSession·operationBacked는 코치와 동일 shape로 맞춰
// 표시층(강사위키)이 코치 visibleCoachEngagements 필터·화면 로직을 재사용하기 쉽게 한다.
import type { CoachEngagementStatusValue, CoachLinkedSessionFacts } from "./coachTypes";

export interface InstructorEngagementView {
  id: string;
  courseName: string;
  operationSessionId: string | null;
  status: CoachEngagementStatusValue;
  source: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  /** 연결된 운영현황 회차에서 읽은 교육형태·시간. 회차 연결이 없거나 회차가 지워졌으면 null. */
  linkedSession: CoachLinkedSessionFacts | null;
  /**
   * 운영현황(강사 instructorsText) 출신 투입인가. 투입현황 표시 기준(운영현황=정본).
   * 계약 등 보조 소스는 false. 미지정(undefined)이면 판정 불가로 보고 숨기지 않는다.
   * 코치 operationBacked와 동일(sourceEngagementId "manual-session:" 접두사).
   */
  operationBacked?: boolean;
}

export interface InstructorEngagementRepository {
  /** 한 강사(InstructorNote.id)의 투입 이력을 읽어 뷰로 반환한다(operationBacked 포함). */
  listEngagements(instructorNoteId: string): Promise<InstructorEngagementView[]>;
}
