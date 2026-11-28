// 운영현황 회차의 "강사"(instructorsText) → 그 회차의 MANUAL 투입(InstructorEngagement)을 맞추는 동기화 워크플로.
// 코치 sessionCoachSyncWorkflow 미러(코치 SHEET ↔ 강사 CONTRACT, coachId ↔ instructorNoteId).
// 정본은 운영현황 강사(OM 확정값)다. 강사 이름을 강사위키 명부(노션 강사 NO에 1:1로 묶인 InstructorNote)로 풀어
// 회차별 MANUAL 투입을 생성하고, 같은 강사의 회차 내 활성 CONTRACT 투입은 MANUAL로 "전환"하며(삭제 아님),
// 명단에 다시 든 강사의 취소된 MANUAL은 "재활성"하고, 명단에서 빠진 활성 MANUAL은 "취소"한다(삭제 아님).
// I/O는 주입한 writer로만 한다(순수 오케스트레이션 → 페이크로 테스트 가능). 이름 매칭·계획은 sessionInstructorSync.
import { normalizeInstructorName } from "./instructorContractMatch";
import { planSessionInstructorSync, planSessionInstructorsByIds, type ExistingSessionInstructorEngagement } from "./sessionInstructorSync";

export interface SyncInstructorSessionInput {
  /** OperationSession.id (uuid) — InstructorEngagement.operationSessionId에 넣는다. */
  operationSessionId: string;
  courseName: string;
  instructorsText: string | null;
  startDate: Date;
  endDate: Date;
  /** 투입 일정으로 만들 교육일들. 비면(과거 데이터) start~end 평일로 전개한다. */
  scheduleDates: Date[];
  startTime: string | null;
  endTime: string | null;
}

export interface SyncInstructor {
  /** InstructorNote.id (강사 정체 앵커, notion_no로 노션에 묶임) */
  id: string;
  name: string;
}

export type EngagementStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED";

/** 투입 생성에 필요한 필드. */
export interface SessionInstructorEngagementCreate {
  sourceEngagementId: string;
  instructorNoteId: string;
  operationSessionId: string;
  courseName: string;
  status: EngagementStatus;
  source: "MANUAL";
  startDate: Date;
  endDate: Date;
  startTime: string | null;
  endTime: string | null;
}

/** 투입 일정 1줄(InstructorEngagementSchedule 컬럼과 일치: operationSessionId 컬럼 없음). */
export interface SessionInstructorScheduleCreate {
  sourceEngagementScheduleId: string;
  engagementId: string;
  instructorNoteId: string;
  date: Date;
  startTime: string;
  endTime: string;
}

/** 워크플로가 쓰는 I/O 최소 집합. 실제 구현은 저장소(트랜잭션 안)에서 주입한다. 삭제는 없다. */
export interface SessionInstructorWriter {
  createEngagement(input: SessionInstructorEngagementCreate): Promise<{ id: string }>;
  replaceSchedules(engagementId: string, rows: SessionInstructorScheduleCreate[]): Promise<void>;
  /** 활성 CONTRACT 투입을 MANUAL로 전환(source만 변경, 일정 보존). */
  convertToManual(engagementIds: string[]): Promise<void>;
  /** 취소됐던 MANUAL 투입을 되살림(status를 회차 날짜 기준으로 복구, 행 보존). */
  reactivateEngagements(engagementIds: string[], status: EngagementStatus): Promise<void>;
  /** 명단에서 빠진 활성 MANUAL 투입을 취소(status=CANCELLED, 행 보존). */
  cancelEngagements(engagementIds: string[]): Promise<void>;
}

export interface SessionInstructorSyncResult {
  checkedSessions: number;
  created: number;
  /** 활성 CONTRACT→MANUAL 전환 건수. */
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

/** 교육일이 비었을 때 start~end 사이 평일(월~금)만 전개. coach workflow와 같은 규칙(UTC 요일, 366일 상한). */
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
 * 회차들을 돌며 강사 ↔ MANUAL 투입을 동기화한다(instructorsText 백필).
 * existingBySession: operationSessionId → 그 회차에 이미 연결된 투입(instructorNoteId·source·status·id).
 * instructors: 강사위키 명부(id·name). dryRun이면 계획 수치만 집계하고 쓰지 않는다.
 */
export async function syncSessionInstructors(
  sessions: ReadonlyArray<SyncInstructorSessionInput>,
  existingBySession: ReadonlyMap<string, ExistingSessionInstructorEngagement[]>,
  instructors: ReadonlyArray<SyncInstructor>,
  writer: SessionInstructorWriter,
  today: Date,
  dryRun: boolean
): Promise<SessionInstructorSyncResult> {
  const nameToInstructorNoteId = new Map(instructors.map((instructor) => [normalizeInstructorName(instructor.name), instructor.id]));
  const result: SessionInstructorSyncResult = { checkedSessions: sessions.length, created: 0, converted: 0, reactivated: 0, cancelled: 0, unmatched: [], apply: !dryRun };

  for (const session of sessions) {
    const existing = existingBySession.get(session.operationSessionId) ?? [];
    const plan = planSessionInstructorSync(session.instructorsText, existing, nameToInstructorNoteId);
    if (plan.unmatchedNames.length > 0) result.unmatched.push({ operationSessionId: session.operationSessionId, names: plan.unmatchedNames });

    if (dryRun) {
      result.created += plan.createInstructorNoteIds.length;
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
    for (const instructorNoteId of plan.createInstructorNoteIds) {
      const base = `manual-session:${session.operationSessionId}:${instructorNoteId}`;
      const engagement = await writer.createEngagement({
        sourceEngagementId: base,
        instructorNoteId,
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
          instructorNoteId,
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

/** 입력 반영 엔진: OM이 위키에서 'ID로 고른 강사들'을 한 회차의 투입으로 맞춘다.
 * instructorsText 백필(syncSessionInstructors)과 같은 writer·sourceEngagementId 키·스케줄 규칙을 쓰므로
 * 입력 쓰기와 백필이 멱등 수렴한다(한쪽이 만든 투입을 다른 쪽이 중복 생성하지 않음).
 * 이름 해석이 없고 선택 집합이 정본이라, 선택에서 빠진 활성 MANUAL은 취소한다(그 회차 활성 강사 = 선택 집합). */
export interface ApplySessionInstructorsInput {
  operationSessionId: string;
  courseName: string;
  /** 위키에서 선택된 instructorNoteId들(정본). */
  instructorNoteIds: ReadonlyArray<string>;
  startDate: Date;
  endDate: Date;
  scheduleDates: Date[];
  startTime: string | null;
  endTime: string | null;
}

export interface ApplySessionInstructorsResult {
  created: number;
  converted: number;
  reactivated: number;
  cancelled: number;
}

export async function applySessionInstructorsByIds(
  input: ApplySessionInstructorsInput,
  existing: ReadonlyArray<ExistingSessionInstructorEngagement>,
  writer: SessionInstructorWriter,
  today: Date
): Promise<ApplySessionInstructorsResult> {
  // 선택이 비면 취소하지 않는다: 빈 본문·실수 클리어로 그 회차 활성 강사가 전원 취소되는 사고를 막는다
  // (instructorsText 경로의 '완전 해석 시에만 취소' 보호와 대칭). 비어있지 않으면 프론트가 동명이인 미해결을
  // 막았으므로 선택 집합이 그 회차의 완전한 활성 강사 = 빠진 활성 MANUAL은 취소.
  const allowCancel = input.instructorNoteIds.length > 0;
  const plan = planSessionInstructorsByIds(input.instructorNoteIds, existing, allowCancel);
  const status = engagementStatusFromDates(input.startDate, input.endDate, today);

  // 순서: 전환→재활성→취소→생성(syncSessionInstructors와 동일). writer는 트랜잭션 안에서 순차 await.
  if (plan.convertEngagementIds.length > 0) await writer.convertToManual(plan.convertEngagementIds);
  if (plan.reactivateEngagementIds.length > 0) await writer.reactivateEngagements(plan.reactivateEngagementIds, status);
  if (plan.cancelEngagementIds.length > 0) await writer.cancelEngagements(plan.cancelEngagementIds);

  const scheduleDates = input.scheduleDates.length > 0 ? dedupeDates(input.scheduleDates) : expandWeekdays(input.startDate, input.endDate);
  const startTime = input.startTime || DEFAULT_START;
  const endTime = input.endTime || DEFAULT_END;
  for (const instructorNoteId of plan.createInstructorNoteIds) {
    const base = `manual-session:${input.operationSessionId}:${instructorNoteId}`;
    const engagement = await writer.createEngagement({
      sourceEngagementId: base,
      instructorNoteId,
      operationSessionId: input.operationSessionId,
      courseName: input.courseName,
      status,
      source: "MANUAL",
      startDate: input.startDate,
      endDate: input.endDate,
      startTime,
      endTime
    });
    await writer.replaceSchedules(
      engagement.id,
      scheduleDates.map((date) => ({
        sourceEngagementScheduleId: `${base}:${date.toISOString().slice(0, 10)}`,
        engagementId: engagement.id,
        instructorNoteId,
        date,
        startTime,
        endTime
      }))
    );
  }

  return {
    created: plan.createInstructorNoteIds.length,
    converted: plan.convertEngagementIds.length,
    reactivated: plan.reactivateEngagementIds.length,
    cancelled: plan.cancelEngagementIds.length
  };
}
