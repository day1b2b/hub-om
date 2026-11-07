import type { CoachEngagementView } from "@/lib/data/coachTypes";
import { parseTimeRange } from "@/lib/googleCalendar/operationCalendarEvent";

// =============================================================================
// 투입별 교육 유형(교육형태 + 하루 교육 시간)
// - 저장하지 않고 읽을 때 연결된 운영현황 회차에서 계산한다(coachActivity와 같은 방식).
// - 회차 연결이 없는 투입은 비워 둔다. 과정명·날짜로 유형을 추정하지 않는다.
// - 4시간/8시간 구분 경계(점심·쉬는 시간 포함 여부, 몇 시간까지 4시간인지)는 아직 정하지 않았다.
//   그래서 여기서는 구간으로 나누지 않고 시작~종료 간격만 돌려준다.
// =============================================================================

export type CoachEduTimeSource = "session" | "engagement";

export interface CoachEngagementEduTime {
  start: string;
  end: string;
  /** 시작~종료 간격(시간). 쉬는 시간을 빼지 않은 값이다. */
  hours: number;
  /** session: 운영현황 회차 시간, engagement: 회차 시간이 비어 투입(코치 근무) 시간을 쓴 경우. */
  source: CoachEduTimeSource;
}

export type CoachEngagementEduType =
  | { linked: false }
  | { linked: true; formatLabel: string; time: CoachEngagementEduTime | null };

type EduTypeInput = Pick<CoachEngagementView, "linkedSession" | "startTime" | "endTime">;

function minutesOf(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function withHours(range: { start: string; end: string }, source: CoachEduTimeSource): CoachEngagementEduTime {
  return { ...range, hours: (minutesOf(range.end) - minutesOf(range.start)) / 60, source };
}

export function coachEngagementEduType(engagement: EduTypeInput): CoachEngagementEduType {
  const session = engagement.linkedSession;
  if (!session) return { linked: false };

  const formatLabel = session.educationFormat === "검토필요" ? "교육형태 확인 필요" : session.educationFormat;
  const sessionRange = parseTimeRange(session.timeText);
  if (sessionRange) return { linked: true, formatLabel, time: withHours(sessionRange, "session") };

  const engagementRange =
    engagement.startTime && engagement.endTime ? parseTimeRange(`${engagement.startTime}~${engagement.endTime}`) : null;
  return { linked: true, formatLabel, time: engagementRange ? withHours(engagementRange, "engagement") : null };
}

/** "09:00~18:00 · 9시간" 형태. 소수 시간은 한 자리까지(4.5시간). */
export function formatEduTime(time: CoachEngagementEduTime): string {
  const hours = Number.isInteger(time.hours) ? String(time.hours) : time.hours.toFixed(1).replace(/\.0$/, "");
  return `${time.start}~${time.end} · ${hours}시간`;
}
