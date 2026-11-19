// 운영현황 회차의 "실습코치"(coachText) → 그 회차의 MANUAL 투입(CoachEngagement)을 맞추는 동기화 워크플로.
// 정본은 운영현황 실습코치(OM 확정값)다. 이 워크플로가 실습코치 이름을 코치위키 명부로 풀어 회차별
// MANUAL 투입을 생성/제거하고, 같은 코치의 회차 내 SHEET 투입은 MANUAL이 대체한다(중복 방지).
// I/O는 주입한 writer로만 한다(순수 오케스트레이션 → 페이크로 테스트 가능). 이름 매칭·계획은 sessionCoachSync.
import { normalizeCoachName } from "./accessToken";
import { planSessionCoachSync, type ExistingSessionEngagement } from "./sessionCoachSync";

export interface SyncSessionInput {
  /** OperationSession.id (uuid) — CoachEngagement.operationSessionId에 넣는다. */
  operationSessionId: string;
  courseName: string;
  coachText: string | null;
  startDate: Date;
  endDate: Date;
  /** 투입 일정으로 만들 교육일들(없으면 start~end 하루씩은 호출부에서 채워 넘긴다). */
  scheduleDates: Date[];
  startTime: string | null;
  endTime: string | null;
}

export interface SyncCoach {
  id: string;
  name: string;
}

/** 투입 생성에 필요한 필드(CoachSheetSyncRepository.createEngagement 입력과 같은 모양). */
export interface SessionEngagementCreate {
  sourceEngagementId: string;
  coachId: string;
  operationSessionId: string;
  courseName: string;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED";
  source: "MANUAL";
  startDate: Date;
  endDate: Date;
  startTime: string | null;
  endTime: string | null;
}

export interface SessionScheduleCreate {
  sourceEngagementScheduleId: string;
  engagementId: string;
  coachId: string;
  operationSessionId: string;
  date: Date;
  startTime: string;
  endTime: string;
}

/** 워크플로가 쓰는 I/O 최소 집합. 실제 구현은 저장소(트랜잭션 안)에서 주입한다. */
export interface SessionCoachWriter {
  createEngagement(input: SessionEngagementCreate): Promise<{ id: string }>;
  replaceSchedules(engagementId: string, rows: SessionScheduleCreate[]): Promise<void>;
  deleteEngagements(engagementIds: string[]): Promise<void>;
}

export interface SessionCoachSyncResult {
  checkedSessions: number;
  created: number;
  removed: number;
  superseded: number;
  unmatched: Array<{ operationSessionId: string; names: string[] }>;
  apply: boolean;
}

/** 날짜로 투입 상태. endDate < today 완료, 기간 중 진행, 그 외 예정. today는 주입(결정적 테스트). */
export function engagementStatusFromDates(startDate: Date, endDate: Date, today: Date): "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" {
  const day = (value: Date) => value.toISOString().slice(0, 10);
  const t = day(today);
  if (day(endDate) < t) return "COMPLETED";
  if (day(startDate) <= t && day(endDate) >= t) return "IN_PROGRESS";
  return "SCHEDULED";
}

const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";

/**
 * 회차들을 돌며 실습코치 ↔ MANUAL 투입을 동기화한다.
 * existingBySession: operationSessionId → 그 회차에 이미 연결된 투입(coachId·source·id).
 * coaches: 코치위키 명부(id·name). dryRun이면 계획 수치만 집계하고 쓰지 않는다.
 */
export async function syncSessionCoaches(
  sessions: ReadonlyArray<SyncSessionInput>,
  existingBySession: ReadonlyMap<string, ExistingSessionEngagement[]>,
  coaches: ReadonlyArray<SyncCoach>,
  writer: SessionCoachWriter,
  today: Date,
  dryRun: boolean
): Promise<SessionCoachSyncResult> {
  const nameToCoachId = new Map(coaches.map((coach) => [normalizeCoachName(coach.name), coach.id]));
  const result: SessionCoachSyncResult = { checkedSessions: sessions.length, created: 0, removed: 0, superseded: 0, unmatched: [], apply: !dryRun };

  for (const session of sessions) {
    const existing = existingBySession.get(session.operationSessionId) ?? [];
    const plan = planSessionCoachSync(session.coachText, existing, nameToCoachId);
    if (plan.unmatchedNames.length > 0) result.unmatched.push({ operationSessionId: session.operationSessionId, names: plan.unmatchedNames });

    if (dryRun) {
      result.created += plan.createCoachIds.length;
      result.removed += plan.removeEngagementIds.length;
      result.superseded += plan.supersedeEngagementIds.length;
      continue;
    }

    const toDelete = [...plan.removeEngagementIds, ...plan.supersedeEngagementIds];
    if (toDelete.length > 0) await writer.deleteEngagements(toDelete);

    const scheduleDates = session.scheduleDates.length > 0 ? session.scheduleDates : [session.startDate, session.endDate];
    const startTime = session.startTime || DEFAULT_START;
    const endTime = session.endTime || DEFAULT_END;
    for (const coachId of plan.createCoachIds) {
      const base = `manual-session:${session.operationSessionId}:${coachId}`;
      const engagement = await writer.createEngagement({
        sourceEngagementId: base,
        coachId,
        operationSessionId: session.operationSessionId,
        courseName: session.courseName,
        status: engagementStatusFromDates(session.startDate, session.endDate, today),
        source: "MANUAL",
        startDate: session.startDate,
        endDate: session.endDate,
        startTime,
        endTime
      });
      await writer.replaceSchedules(
        engagement.id,
        dedupeDates(scheduleDates).map((date) => ({
          sourceEngagementScheduleId: `${base}:${date.toISOString().slice(0, 10)}`,
          engagementId: engagement.id,
          coachId,
          operationSessionId: session.operationSessionId,
          date,
          startTime,
          endTime
        }))
      );
      result.created += 1;
    }
    result.removed += plan.removeEngagementIds.length;
    result.superseded += plan.supersedeEngagementIds.length;
  }

  return result;
}

function dedupeDates(dates: ReadonlyArray<Date>): Date[] {
  const seen = new Set<string>();
  const out: Date[] = [];
  for (const date of dates) {
    const key = date.toISOString().slice(0, 10);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(date);
  }
  return out;
}
