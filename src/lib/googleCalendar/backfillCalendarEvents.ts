// 매핑 없는 예정 회차를 구글 캘린더에 소급 생성하는 관리자 도구의 오케스트레이터.
//
// GET(dryRun) = 무엇이 빠졌는지 미리보기(쓰기 없음) + 파트 캘린더 쓰기 권한 진단.
// POST(apply) = 실제 insert + 매핑 저장. 기본은 초대 메일 억제(sendUpdates=none), 상한 있음.
//
// 되돌리기 어려운 작업이라 기본값을 보수적으로 둔다: 예정(오늘 이후) 회차만, 메일 억제,
// 이벤트 상한. 넓히려면 호출부가 from·limit·notify로 명시한다.

import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { getSeoulToday } from "@/lib/seoulDate";
import { isCalendarWriteEnabled, listPartCalendars, resolvePartCalendarId } from "./calendarWriteConfig";
import { deleteEvent, insertEvent, readCalendarAccessRole } from "./calendarWriteClient";
import { listAllCalendarEventLinks, saveCalendarEventLink, listCalendarEventLinks, deleteCalendarEventLinks } from "./calendarEventLinkRepository";
import { planCalendarBackfill, type BackfillPlanItem } from "./backfillCalendarEventsRules";

/** 한 번의 apply에서 만들 이벤트 수 상한 기본값. 실수로 대량 생성되는 것을 막는 안전선. */
const DEFAULT_INSERT_LIMIT = 100;
/** 쓰기 확인용(리포트 canWrite): 이 권한이면 확실히 만들 수 있다. */
const WRITABLE_ROLES = new Set(["owner", "writer"]);
/**
 * apply 차단용: 이 권한이면 insert가 반드시 403이므로 아예 시도하지 않는다.
 * owner·writer는 물론, 권한을 못 읽은 경우(null=목록에 없음, 조회 오류)도 시도한다 —
 * B2B 계정이 소유하지만 calendarList에 없어 404(null)로 오는 캘린더까지 막으면 1·3파트
 * 소급이 통째로 안 되기 때문이다. 시도했다가 403이면 회차별 실패로 남긴다.
 */
const READ_ONLY_ROLES = new Set(["reader", "freeBusyReader"]);

export interface BackfillCalendarOptions {
  dryRun: boolean;
  /** 이 날짜 이후(포함)에 끝나는 회차만. 미지정 시 오늘(KST). "all"이면 전체 기간. */
  from?: string;
  /** apply에서 만들 이벤트 수 상한. 미지정 시 100. */
  limit?: number;
  /** true면 참석자에게 초대 메일 발송. 미지정 시 false(억제). */
  notifyAttendees?: boolean;
}

export type BackfillOutcomeResult = "planned" | "inserted" | "skipped" | "failed";

export interface BackfillOutcome {
  operationId: string;
  companyName: string;
  courseName: string;
  roundNo: string;
  om: string;
  onsiteOm: string;
  operationStatus: string;
  partKey: string | null;
  calendarId: string | null;
  lastDate: string | null;
  eventDates: string[];
  unresolvedNames: string[];
  result: BackfillOutcomeResult;
  detail?: string;
}

export interface BackfillCalendarInfo {
  partKey: string;
  calendarId: string;
  /** owner·writer·reader·freeBusyReader, 목록에 없으면 null, 조회 실패면 error 문자열. */
  accessRole: string | null;
  canWrite: boolean;
  accessError?: string;
  existingMappedEvents: number;
  plannedOperations: number;
  plannedEvents: number;
}

export interface BackfillCalendarResult {
  ok: boolean;
  enabled: boolean;
  dryRun: boolean;
  from: string;
  limit: number;
  notifyAttendees: boolean;
  calendars: BackfillCalendarInfo[];
  totals: {
    operationsScanned: number;
    inScope: number;
    alreadyComplete: number;
    plannedOperations: number;
    plannedEvents: number;
    insertedEvents: number;
    skippedOperations: number;
    failedOperations: number;
    capped: boolean;
  };
  outcomes: BackfillOutcome[];
  warning?: string;
}

function seoulTodayIso(): string {
  const today = getSeoulToday();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}

/** 미지정이면 오늘(KST), "all"이면 전체 기간, 그 외는 넘어온 날짜를 그대로 기준일로 쓴다. */
function resolveFrom(from: string | undefined): string {
  if (!from) return seoulTodayIso();
  if (from === "all") return "0000-01-01";
  return from;
}

function toOutcome(item: BackfillPlanItem, result: BackfillOutcomeResult): BackfillOutcome {
  return {
    operationId: item.operationId,
    companyName: item.companyName,
    courseName: item.courseName,
    roundNo: item.roundNo,
    om: item.om,
    onsiteOm: item.onsiteOm,
    operationStatus: item.operationStatus,
    partKey: item.partKey,
    calendarId: item.calendarId,
    lastDate: item.lastDate,
    eventDates: item.plans.map((plan) => plan.eventDate),
    unresolvedNames: item.unresolvedNames,
    result,
    ...(item.skipReason ? { detail: item.skipReason } : {})
  };
}

export async function backfillMissingCalendarEvents(
  options: BackfillCalendarOptions
): Promise<BackfillCalendarResult> {
  const from = resolveFrom(options.from);
  const limit = options.limit && options.limit > 0 ? options.limit : DEFAULT_INSERT_LIMIT;
  const notifyAttendees = options.notifyAttendees === true;

  const base: BackfillCalendarResult = {
    ok: true,
    enabled: true,
    dryRun: options.dryRun,
    from,
    limit,
    notifyAttendees,
    calendars: [],
    totals: {
      operationsScanned: 0,
      inScope: 0,
      alreadyComplete: 0,
      plannedOperations: 0,
      plannedEvents: 0,
      insertedEvents: 0,
      skippedOperations: 0,
      failedOperations: 0,
      capped: false
    },
    outcomes: []
  };

  if (!isCalendarWriteEnabled()) {
    return {
      ...base,
      enabled: false,
      warning: "구글 캘린더 연동이 꺼져 있습니다(GOOGLE_CAL_OAUTH_*·GOOGLE_CAL_PART_CALENDARS 확인)."
    };
  }

  const [operations, links, users] = await Promise.all([
    getOperationRepository().listOperations(),
    listAllCalendarEventLinks(),
    listTeamUsers()
  ]);

  // 회차별로 이미 매핑된 교육일 집합. 이 날짜는 다시 만들지 않는다(중복 방지).
  const mappedDatesByOperation = new Map<string, Set<string>>();
  const existingByCalendar = new Map<string, number>();
  for (const link of links) {
    let dates = mappedDatesByOperation.get(link.operationId);
    if (!dates) {
      dates = new Set<string>();
      mappedDatesByOperation.set(link.operationId, dates);
    }
    dates.add(link.eventDate);
    existingByCalendar.set(link.calendarId, (existingByCalendar.get(link.calendarId) ?? 0) + 1);
  }

  // 파트 캘린더별 쓰기 권한(accessRole)을 읽는다 — 2파트가 통째로 비는 원인이
  // 쓰기 권한(ACL) 미공유인지, 파트 매칭 실패인지 데이터로 가르기 위한 진단이다.
  const calendarInfos: BackfillCalendarInfo[] = [];
  const accessRoleByCalendar = new Map<string, string | null>();
  for (const { partKey, calendarId } of listPartCalendars()) {
    let accessRole: string | null = null;
    let accessError: string | undefined;
    try {
      accessRole = await readCalendarAccessRole(calendarId);
      accessRoleByCalendar.set(calendarId, accessRole);
    } catch (error) {
      accessError = error instanceof Error ? error.message : String(error);
    }
    calendarInfos.push({
      partKey,
      calendarId,
      accessRole,
      canWrite: accessRole !== null && WRITABLE_ROLES.has(accessRole),
      ...(accessError ? { accessError } : {}),
      existingMappedEvents: existingByCalendar.get(calendarId) ?? 0,
      plannedOperations: 0,
      plannedEvents: 0
    });
  }

  // 적용(apply) 때만, 확실히 읽기전용인 캘린더만 뺀다(insert가 반드시 403인 경우).
  // owner·writer·null(목록에 없음)·조회오류는 시도한다 — 소유했지만 목록에 없는 캘린더를
  // 막지 않기 위함. dryRun은 권한과 무관하게 전부 보여준다.
  const writableCalendarIds = options.dryRun
    ? null
    : new Set(
        calendarInfos
          .filter((info) => !(info.accessRole !== null && READ_ONLY_ROLES.has(info.accessRole)))
          .map((info) => info.calendarId)
      );

  const plan = planCalendarBackfill({
    operations,
    mappedDatesByOperation,
    users,
    from,
    resolveCalendarId: (partKey) => resolvePartCalendarId(partKey),
    writableCalendarIds
  });

  const infoByCalendar = new Map(calendarInfos.map((info) => [info.calendarId, info]));
  const outcomes: BackfillOutcome[] = [];
  let insertedEvents = 0;
  let plannedOperations = 0;
  let plannedEvents = 0;
  let skippedOperations = 0;
  let failedOperations = 0;
  let capped = false;

  for (const item of plan.items) {
    if (item.status === "skipped") {
      skippedOperations += 1;
      outcomes.push(toOutcome(item, "skipped"));
      continue;
    }

    // planned
    plannedOperations += 1;
    plannedEvents += item.plans.length;
    const info = item.calendarId ? infoByCalendar.get(item.calendarId) : undefined;
    if (info) {
      info.plannedOperations += 1;
      info.plannedEvents += item.plans.length;
    }

    if (options.dryRun) {
      outcomes.push(toOutcome(item, "planned"));
      continue;
    }

    // 상한은 회차 사이에서만 본다 — 회차 중간에 끊으면 일부만 만들어진 회차가 남는다.
    if (insertedEvents >= limit) {
      capped = true;
      skippedOperations += 1;
      outcomes.push({ ...toOutcome(item, "skipped"), detail: `이벤트 상한(${limit}) 도달 — 이번 실행에서 제외` });
      continue;
    }

    try {
      for (const eventPlan of item.plans) {
        const eventId = await insertEvent(item.calendarId as string, eventPlan.body, { notifyAttendees });
        await saveCalendarEventLink({
          operationId: item.operationId,
          calendarId: item.calendarId as string,
          eventId,
          eventDate: eventPlan.eventDate
        });
        insertedEvents += 1;
      }
      outcomes.push(toOutcome(item, "inserted"));
    } catch (error) {
      failedOperations += 1;
      const detail = error instanceof Error ? error.message : String(error);
      outcomes.push({ ...toOutcome(item, "failed"), detail });
      console.error(`[gcal-backfill] ${item.operationId} 소급 생성 실패:`, detail);
    }
  }

  if (!options.dryRun) {
    console.info(
      `[gcal-backfill] 소급 생성: ${insertedEvents}건 생성, ${skippedOperations}건 건너뜀, ${failedOperations}건 실패` +
        `${capped ? ` (상한 ${limit} 도달)` : ""}, 메일=${notifyAttendees ? "발송" : "억제"}`
    );
  }

  return {
    ...base,
    ok: failedOperations === 0,
    calendars: calendarInfos,
    totals: {
      operationsScanned: operations.length,
      inScope: plan.inScope,
      alreadyComplete: plan.alreadyComplete,
      plannedOperations,
      plannedEvents,
      insertedEvents,
      skippedOperations,
      failedOperations,
      capped
    },
    outcomes
  };
}

export interface BackfillCleanupOutcome {
  operationId: string;
  deletedEvents: number;
  result: "deleted" | "failed";
  detail?: string;
}

export interface BackfillCleanupResult {
  ok: boolean;
  enabled: boolean;
  notifyAttendees: boolean;
  requestedOperations: number;
  deletedEvents: number;
  failedOperations: number;
  outcomes: BackfillCleanupOutcome[];
  warning?: string;
}

/**
 * 소급으로 만든 이벤트를 되돌린다(정리용). **명시한 회차(operationId)만** 지운다 —
 * 전체 삭제는 없다. 회차별로 매핑된 이벤트를 모두 지우고 매핑도 함께 정리한다.
 * 기본은 메일 억제(취소 통지 없음) — 조용히 만든 것을 조용히 되돌린다.
 *
 * 예: 규칙을 바꾸기 전에 만들어진 부적절한 이벤트(교육일 없는 기간 통블록 등)를 걷어낼 때.
 * 주의: 매핑을 모두 지우면 수정 시 정방향 반영이 건너뛴다. 자동 복구를 보장하지 않는다.
 */
export async function deleteBackfilledCalendarEvents(
  operationIds: string[],
  options?: { notifyAttendees?: boolean }
): Promise<BackfillCleanupResult> {
  const notifyAttendees = options?.notifyAttendees === true;
  const requested = [...new Set(operationIds.map((id) => id.trim()).filter(Boolean))];

  const base: BackfillCleanupResult = {
    ok: true,
    enabled: true,
    notifyAttendees,
    requestedOperations: requested.length,
    deletedEvents: 0,
    failedOperations: 0,
    outcomes: []
  };

  if (!isCalendarWriteEnabled()) {
    return { ...base, enabled: false, warning: "구글 캘린더 연동이 꺼져 있습니다(GOOGLE_CAL_OAUTH_*·GOOGLE_CAL_PART_CALENDARS 확인)." };
  }

  const outcomes: BackfillCleanupOutcome[] = [];
  let deletedEvents = 0;
  let failedOperations = 0;

  for (const operationId of requested) {
    const links = await listCalendarEventLinks(operationId);
    if (links.length === 0) {
      outcomes.push({ operationId, deletedEvents: 0, result: "deleted", detail: "매핑된 이벤트 없음" });
      continue;
    }

    try {
      for (const link of links) {
        await deleteEvent(link.calendarId, link.eventId, { notifyAttendees });
        deletedEvents += 1;
      }
      await deleteCalendarEventLinks(operationId);
      outcomes.push({ operationId, deletedEvents: links.length, result: "deleted" });
    } catch (error) {
      failedOperations += 1;
      const detail = error instanceof Error ? error.message : String(error);
      outcomes.push({ operationId, deletedEvents: 0, result: "failed", detail });
      console.error(`[gcal-backfill] ${operationId} 소급 이벤트 정리 실패:`, detail);
    }
  }

  console.info(
    `[gcal-backfill] 소급 정리: ${deletedEvents}건 삭제, ${failedOperations}건 실패, 메일=${notifyAttendees ? "발송" : "억제"}`
  );

  return { ...base, ok: failedOperations === 0, deletedEvents, failedOperations, outcomes };
}
