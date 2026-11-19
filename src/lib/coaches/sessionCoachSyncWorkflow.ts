// 운영현황 회차의 "실습코치"(coachText) → 그 회차의 MANUAL 투입(CoachEngagement)을 맞추는 동기화 워크플로.
// 정본은 운영현황 실습코치(OM 확정값)다. 이 워크플로가 실습코치 이름을 코치위키 명부로 풀어 회차별
// MANUAL 투입을 생성하고, 같은 코치의 회차 내 활성 SHEET 투입은 MANUAL로 "전환"하며(삭제 아님 → 평가 보존),
// 명단에 다시 든 코치의 취소된 MANUAL은 "재활성"하고, 명단에서 빠진 활성 MANUAL은 "취소"한다(삭제 아님).
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
  /** 투입 일정으로 만들 교육일들. 비면(과거 데이터) start~end 평일로 전개한다. */
  scheduleDates: Date[];
  startTime: string | null;
  endTime: string | null;
}

export interface SyncCoach {
  id: string;
  name: string;
}

export type EngagementStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED";

/** 투입 생성에 필요한 필드(CoachSheetSyncRepository.createEngagement 입력과 같은 모양). */
export interface SessionEngagementCreate {
  sourceEngagementId: string;
  coachId: string;
  operationSessionId: string;
  courseName: string;
  status: EngagementStatus;
  source: "MANUAL";
  startDate: Date;
  endDate: Date;
  startTime: string | null;
  endTime: string | null;
}

/** 투입 일정 1줄(CoachEngagementSchedule 컬럼과 일치: operationSessionId 컬럼 없음). */
export interface SessionScheduleCreate {
  sourceEngagementScheduleId: string;
  engagementId: string;
  coachId: string;
  date: Date;
  startTime: string;
  endTime: string;
}

/** 워크플로가 쓰는 I/O 최소 집합. 실제 구현은 저장소(트랜잭션 안)에서 주입한다. 삭제는 없다. */
export interface SessionCoachWriter {
  createEngagement(input: SessionEngagementCreate): Promise<{ id: string }>;
  replaceSchedules(engagementId: string, rows: SessionScheduleCreate[]): Promise<void>;
  /** 활성 SHEET 투입을 MANUAL로 전환(source만 변경, 평가·일정 보존). */
  convertToManual(engagementIds: string[]): Promise<void>;
  /** 취소됐던 MANUAL 투입을 되살림(status를 회차 날짜 기준으로 복구, 행·평가 보존). */
  reactivateEngagements(engagementIds: string[], status: EngagementStatus): Promise<void>;
  /** 명단에서 빠진 활성 MANUAL 투입을 취소(status=CANCELLED, 행·평가 보존). */
  cancelEngagements(engagementIds: string[]): Promise<void>;
}

export interface SessionCoachSyncResult {
  checkedSessions: number;
  created: number;
  /** 활성 SHEET→MANUAL 전환 건수. */
  converted: number;
  /** 취소됐다가 명단 복귀로 재활성된 건수. */
  reactivated: number;
  /** 명단에서 빠져 취소된 활성 MANUAL 건수. */
  cancelled: number;
  unmatched: Array<{ operationSessionId: string; names: string[] }>;
  apply: boolean;
}

/** 날짜로 투입 상태. endDate < today 완료, 기간 중 진행, 그 외 예정. today는 주입(결정적 테스트). */
export function engagementStatusFromDates(startDate: Date, endDate: Date, today: Date): EngagementStatus {
  const day = (value: Date) => value.toISOString().slice(0, 10);
  const t = day(today);
  if (day(endDate) < t) return "COMPLETED";
  if (day(startDate) <= t && day(endDate) >= t) return "IN_PROGRESS";
  return "SCHEDULED";
}

const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";

/** 교육일이 비었을 때 start~end 사이 평일(월~화~금)만 전개. engagementApi.weekdayScheduleEntries와 같은 규칙(UTC 요일, 366일 상한). */
export function expandWeekdays(startDate: Date, endDate: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(startDate);
  let safety = 0;
  while (cursor <= endDate && safety < 366) {
    const day = cursor.getUTCDay();
    if (day >= 1 && day <= 5) out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    safety++;
  }
  return out;
}

/**
 * 회차들을 돌며 실습코치 ↔ MANUAL 투입을 동기화한다.
 * existingBySession: operationSessionId → 그 회차에 이미 연결된 투입(coachId·source·status·id).
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
  const result: SessionCoachSyncResult = { checkedSessions: sessions.length, created: 0, converted: 0, reactivated: 0, cancelled: 0, unmatched: [], apply: !dryRun };

  for (const session of sessions) {
    const existing = existingBySession.get(session.operationSessionId) ?? [];
    const plan = planSessionCoachSync(session.coachText, existing, nameToCoachId);
    if (plan.unmatchedNames.length > 0) result.unmatched.push({ operationSessionId: session.operationSessionId, names: plan.unmatchedNames });

    if (dryRun) {
      result.created += plan.createCoachIds.length;
      result.converted += plan.convertEngagementIds.length;
      result.reactivated += plan.reactivateEngagementIds.length;
      result.cancelled += plan.cancelEngagementIds.length;
      continue;
    }

    const status = engagementStatusFromDates(session.startDate, session.endDate, today);
    if (plan.convertEngagementIds.length > 0) await writer.convertToManual(plan.convertEngagementIds);
    if (plan.reactivateEngagementIds.length > 0) await writer.reactivateEngagements(plan.reactivateEngagementIds, status);
    if (plan.cancelEngagementIds.length > 0) await writer.cancelEngagements(plan.cancelEngagementIds);

    const scheduleDates = session.scheduleDates.length > 0 ? dedupeDates(session.scheduleDates) : expandWeekdays(session.startDate, session.endDate);
    const startTime = session.startTime || DEFAULT_START;
    const endTime = session.endTime || DEFAULT_END;
    for (const coachId of plan.createCoachIds) {
      const base = `manual-session:${session.operationSessionId}:${coachId}`;
      const engagement = await writer.createEngagement({
        sourceEngagementId: base,
        coachId,
        operationSessionId: session.operationSessionId,
        courseName: session.courseName,
        status,
        source: "MANUAL",
        startDate: session.startDate,
        endDate: session.endDate,
        startTime,
        endTime
      });
      await writer.replaceSchedules(
        engagement.id,
        scheduleDates.map((date) => ({
          sourceEngagementScheduleId: `${base}:${date.toISOString().slice(0, 10)}`,
          engagementId: engagement.id,
          coachId,
          date,
          startTime,
          endTime
        }))
      );
      result.created += 1;
    }
    result.converted += plan.convertEngagementIds.length;
    result.reactivated += plan.reactivateEngagementIds.length;
    result.cancelled += plan.cancelEngagementIds.length;
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
