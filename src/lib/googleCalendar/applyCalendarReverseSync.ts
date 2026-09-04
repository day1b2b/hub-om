// 역반영 계획을 실제로 적용한다(calendarReverseSync.ts가 만든 계획을 받아 실행).
//
// 쓰기 범위를 좁게 고정한다(db-write-safety):
//  - 운영현황에 쓰는 것은 실제 교육일(educationDates)과 시간(timeText)뿐이다.
//    매핑 단위가 연속 구간이므로, 이벤트를 옮기면 그 구간의 날짜들이 함께 움직인다.
//    startDate/endDate는 리포지토리가 교육일 목록의 최소·최대로 다시 계산한다.
//    교육일이 등록되지 않은 옛 회차는 startDate·endDate·timeText를 직접 쓴다.
//  - 대상은 캘린더 매핑이 있는 회차 중 판정이 잡힌 건만이다.
//  - 1회 실행 상한(CALENDAR_REVERSE_SYNC_MAX_APPLY, 기본 20건)을 넘으면 한 건도 적용하지 않는다.
//  - 바꾼 값은 이전값→새값으로 로그에 남긴다([gcal-reverse] 접두어로 Coolify 런타임 로그에서 검색).
//
// 한계: 시간(timeText)은 회차 단위 값이다. 매니저가 특정 교육일의 시간만 바꿔도 그 회차
// 전체 시간이 바뀌고, 다른 교육일 이벤트도 다음 반영에서 같은 시간으로 맞춰진다.
//
// 사람이 캘린더에서 지운 이벤트는 여기서 다루지 않는다. 판정 단계가 무조치로 걸러내고
// 로그만 남긴다(D8) — 자동으로 되살리면 사람이 의도해서 지운 일정이 10분마다 돌아온다.
// 되살리는 길은 hub-om에서 그 회차를 저장하는 것뿐이다(정방향 반영이 다시 만든다).
//
// 스펙: docs/plans/2026-08-19-operations-calendar-reflect.md (D7~D9, 5-B절)

import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { patchEvent } from "./calendarWriteClient";
import type { OperationSession, UpdateOperationInput } from "@/lib/data/operationTypes";
import { moveCalendarEventLinkDate } from "./calendarEventLinkRepository";
import { buildCalendarEventBodies } from "./operationCalendarEvent";
import { planCalendarReverseSync, type ReverseSyncPlan } from "./calendarReverseSync";
import { replaceEducationRun, type ReverseSyncItem } from "./calendarReverseSyncRules";

const DEFAULT_MAX_APPLY = 20;

export interface ReverseSyncOutcome {
  item: ReverseSyncItem;
  applied: boolean;
  detail: string;
}

export interface ReverseSyncApplyResult extends ReverseSyncPlan {
  dryRun: false;
  appliedCount: number;
  failedCount: number;
  outcomes: ReverseSyncOutcome[];
}

export async function applyCalendarReverseSync(): Promise<ReverseSyncApplyResult> {
  const plan = await planCalendarReverseSync();
  const base: ReverseSyncApplyResult = { ...plan, dryRun: false, appliedCount: 0, failedCount: 0, outcomes: [] };

  if (!plan.enabled || plan.items.length === 0) return base;

  const maxApply = readMaxApply();
  if (plan.items.length > maxApply) {
    // 날짜 계산이나 데이터가 틀어졌을 때 운영현황을 대량으로 덮어쓰는 것을 막는 안전장치.
    return {
      ...base,
      ok: false,
      warning: `적용 대상 ${plan.items.length}건이 1회 상한(${maxApply}건)을 넘어 아무것도 적용하지 않았습니다. 미리보기(GET)로 확인한 뒤 CALENDAR_REVERSE_SYNC_MAX_APPLY를 조정하세요.`
    };
  }

  const outcomes: ReverseSyncOutcome[] = [];
  let appliedCount = 0;
  let failedCount = 0;

  for (const item of plan.items) {
    try {
      const detail = await applyItem(item);
      outcomes.push({ item, applied: true, detail });
      appliedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[gcal-reverse] ${item.operationId} ${item.action} 실패:`, message);
      outcomes.push({ item, applied: false, detail: message });
      failedCount += 1;
    }
  }

  return { ...base, appliedCount, failedCount, outcomes };
}

async function applyItem(item: ReverseSyncItem): Promise<string> {
  if (item.action === "운영현황 반영") return applyScheduleToOperation(item);

  return revertEventToOperation(item);
}

/** 캘린더에서 바뀐 날짜·시간을 운영현황에 쓴다. 그 외 필드는 캘린더 쪽을 되돌린다. */
async function applyScheduleToOperation(item: ReverseSyncItem): Promise<string> {
  const change = item.scheduleChange;
  if (!change) throw new Error("날짜·시간 변경 내용이 없습니다.");

  const operation = await findOperation(item.operationId);
  const detail = item.perEducationDay
    ? await applyEducationRunChange(item, operation, change.to)
    : await applyRangeChange(item, change.to);

  // 사람이 날짜와 함께 제목·장소도 바꿨으면 그 필드만 되돌린다.
  // 날짜·시간은 방금 받아들인 값이므로 patch에 넣지 않는다.
  const revertFields = (item.revertFields ?? []).filter((field) => field !== "날짜·시간");

  // 표식(hubOmSchedule)은 받아들인 값으로 반드시 갱신한다(D12). 안 하면 표식이 옛 값에 머물러,
  // 사람이 나중에 정확히 옛 날짜로 되돌려 놓았을 때 "hub-om이 쓴 그대로"로 오판해 되돌려 버린다.
  const refreshed = await findOperation(item.operationId);
  const expected = findPlanBody(refreshed, change.to.startDate, item.partKey);
  if (expected) {
    await patchEvent(item.calendarId, item.eventId, {
      ...(revertFields.length > 0 ? { summary: expected.summary, location: expected.location ?? "" } : {}),
      extendedProperties: expected.extendedProperties
    });
    if (revertFields.length > 0) {
      console.info(`[gcal-reverse] ${item.operationId} ${revertFields.join(", ")} 원복 (event=${item.eventId})`);
    }
  }

  return revertFields.length > 0 ? `${detail} + ${revertFields.join(", ")} 원복` : detail;
}

/** 연속 구간 이벤트: 그 이벤트가 담당하던 구간을 새 구간으로 옮긴다. */
async function applyEducationRunChange(
  item: ReverseSyncItem,
  operation: OperationSession,
  to: { startDate: string; endDate: string; timeText: string }
): Promise<string> {
  const { dates, conflict } = replaceEducationRun(
    operation.educationDates,
    item.eventDate,
    item.eventEndDate,
    to.startDate,
    to.endDate
  );

  if (conflict) {
    throw new Error(
      `옮긴 구간(${to.startDate}~${to.endDate})이 다른 교육일과 겹쳐 반영하지 않았습니다. 운영현황에서 교육일을 정리해주세요.`
    );
  }

  const timeChanged = to.timeText !== "" && to.timeText !== operation.timeText;

  await updateOperationWithLinkMoved(item, to.startDate, {
    educationDates: dates,
    ...(timeChanged ? { timeText: to.timeText } : {})
  });

  const before = item.eventDate === item.eventEndDate ? item.eventDate : `${item.eventDate}~${item.eventEndDate}`;
  const after = to.startDate === to.endDate ? to.startDate : `${to.startDate}~${to.endDate}`;
  console.info(
    `[gcal-reverse] ${item.operationId} 교육일 반영: ${before} → ${after}` +
      `${timeChanged ? ` / 시간 ${operation.timeText} → ${to.timeText}` : ""} (event=${item.eventId})`
  );

  return `교육일 ${before} → ${after}${timeChanged ? ` · 시간 ${to.timeText}` : ""}`;
}

/** 교육일이 등록되지 않은 옛 회차: 기간 이벤트 1건이므로 시작·종료·시간을 직접 쓴다. */
async function applyRangeChange(
  item: ReverseSyncItem,
  to: { startDate: string; endDate: string; timeText: string }
): Promise<string> {
  await updateOperationWithLinkMoved(item, to.startDate, {
    startDate: to.startDate,
    endDate: to.endDate,
    timeText: to.timeText
  });

  const summary = `${to.startDate}~${to.endDate} ${to.timeText}`.trim();
  console.info(`[gcal-reverse] ${item.operationId} 기간 반영: ${summary} (event=${item.eventId})`);

  return `날짜·시간 반영 (${summary})`;
}

/**
 * 캘린더를 운영현황 값으로 되돌린다.
 * attendees는 절대 함께 보내지 않는다 — 초대를 거절하거나 자기 캘린더에서 지운 사람을
 * 다시 초대하지 않기로 했다(D9).
 */
async function revertEventToOperation(item: ReverseSyncItem): Promise<string> {
  const operation = await findOperation(item.operationId);
  const expected = findPlanBody(operation, item.eventDate, item.partKey);
  if (!expected) throw new Error(`운영현황에 없는 교육일(${item.eventDate})입니다.`);

  await patchEvent(item.calendarId, item.eventId, {
    summary: expected.summary,
    location: expected.location ?? "",
    start: expected.start,
    end: expected.end,
    // 되돌린 날짜·시간을 표식으로 함께 남긴다. 표식 없이 되돌리면 다음 실행이 이 patch를 사람의 수정으로 본다.
    extendedProperties: expected.extendedProperties
  });

  const fields = item.revertFields?.join(", ") ?? "";
  console.info(`[gcal-reverse] ${item.operationId} 원복: ${fields} (event=${item.eventId})`);

  return `캘린더 원복 (${fields})`;
}

/**
 * 매핑의 교육일을 새 구간 시작일로 **먼저** 옮긴 뒤 운영현황을 쓴다.
 *
 * 저장소는 CalendarReflectingOperationRepository로 감싸여 있어, 시간(timeText)이나 기간이 바뀌면
 * updateOperation 안에서 정방향 반영이 바로 돈다. 그때 매핑이 아직 옛 날짜에 있으면 정방향 반영은
 * "새 구간에 이벤트 없음 → insert, 옛 구간 매핑은 교육일에서 빠짐 → delete"로 판단해 **매니저가 옮긴
 * 이벤트를 지우고 새 이벤트를 만든다**(취소·초대 메일이 한 번씩 더 나간다). 매핑을 먼저 옮겨 두면
 * 같은 이벤트를 patch만 하고 끝난다. 쓰기가 실패하면 매핑을 되돌려 원래 상태를 유지한다.
 */
async function updateOperationWithLinkMoved(
  item: ReverseSyncItem,
  nextStartDate: string,
  input: UpdateOperationInput
): Promise<void> {
  const moved = item.eventDate !== nextStartDate;
  if (moved) await moveCalendarEventLinkDate(item.operationId, item.eventDate, nextStartDate);

  try {
    await getOperationRepository().updateOperation(item.operationId, input);
  } catch (error) {
    if (moved) await moveCalendarEventLinkDate(item.operationId, nextStartDate, item.eventDate);
    throw error;
  }
}

function findPlanBody(operation: OperationSession, eventDate: string, partKey: null | string) {
  return buildCalendarEventBodies(operation, [], partKey).find((entry) => entry.eventDate === eventDate)?.body;
}

async function findOperation(operationId: string): Promise<OperationSession> {
  const operation = await getOperationRepository().getOperationById(operationId);
  if (!operation) throw new Error(`회차를 찾지 못했습니다(${operationId}).`);

  return operation;
}

function readMaxApply(): number {
  const parsed = Number(process.env.CALENDAR_REVERSE_SYNC_MAX_APPLY?.trim());

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_APPLY;
}
