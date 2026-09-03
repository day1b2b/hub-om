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
// 스펙: docs/plans/2026-08-19-operations-calendar-reflect.md (D7~D9, 5-B절)

import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { normalizePersonName } from "@/lib/data/myOperations";
import { splitPersonNames } from "@/lib/data/personNames";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { sendSlackDirectMessage } from "@/lib/slack/notifySlack";
import { insertEvent, patchEvent } from "./calendarWriteClient";
import { resolveCalendarTargets } from "./calendarParticipants";
import { resolvePartCalendarId } from "./calendarWriteConfig";
import type { OperationSession } from "@/lib/data/operationTypes";
import {
  deleteCalendarEventLink,
  moveCalendarEventLinkDate,
  saveCalendarEventLink
} from "./calendarEventLinkRepository";
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
  if (item.action === "캘린더 원복") return revertEventToOperation(item);
  if (item.action === "복구 중단") return abandonEvent(item);

  return recreateEvent(item);
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
  if (revertFields.length === 0) return detail;

  const refreshed = await findOperation(item.operationId);
  const expected = findPlanBody(refreshed, change.to.startDate, item.partKey);
  if (expected) {
    await patchEvent(item.calendarId, item.eventId, {
      summary: expected.summary,
      location: expected.location ?? ""
    });
    console.info(`[gcal-reverse] ${item.operationId} ${revertFields.join(", ")} 원복 (event=${item.eventId})`);
  }

  return `${detail} + ${revertFields.join(", ")} 원복`;
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

  await getOperationRepository().updateOperation(item.operationId, {
    educationDates: dates,
    ...(timeChanged ? { timeText: to.timeText } : {})
  });

  if (item.eventDate !== to.startDate) {
    await moveCalendarEventLinkDate(item.operationId, item.eventDate, to.startDate);
  }

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
  await getOperationRepository().updateOperation(item.operationId, {
    startDate: to.startDate,
    endDate: to.endDate,
    timeText: to.timeText
  });

  if (item.eventDate !== to.startDate) {
    await moveCalendarEventLinkDate(item.operationId, item.eventDate, to.startDate);
  }

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
    end: expected.end
  });

  const fields = item.revertFields?.join(", ") ?? "";
  console.info(`[gcal-reverse] ${item.operationId} 원복: ${fields} (event=${item.eventId})`);

  return `캘린더 원복 (${fields})`;
}

/** 사람이 지운 원본 이벤트를 다시 만들고 담당 OM에게 알린다(D8). */
async function recreateEvent(item: ReverseSyncItem): Promise<string> {
  const operation = await findOperation(item.operationId);
  const targets = await resolveCalendarTargets(operation);
  const calendarId = resolvePartCalendarId(targets.partKey) || item.calendarId;
  const plan = buildCalendarEventBodies(operation, targets.attendeeEmails, targets.partKey).find(
    (entry) => entry.eventDate === item.eventDate
  );

  if (!plan) throw new Error(`운영현황에 없는 교육일(${item.eventDate})이라 다시 만들지 않았습니다.`);

  const eventId = await insertEvent(calendarId, plan.body);
  await saveCalendarEventLink(
    {
      operationId: operation.operationId,
      calendarId,
      eventId,
      eventDate: item.eventDate
    },
    { recreated: true }
  );
  console.info(`[gcal-reverse] ${item.operationId} 이벤트 재생성: ${item.eventId} → ${eventId} (${item.eventDate})`);

  const notified = await notifyOm(item, recreatedText(item));

  return notified ? "이벤트 재생성 + 담당 OM 알림" : "이벤트 재생성 (담당 OM 알림 실패/대상 없음)";
}

/**
 * 되살린 일정을 사람이 또 지웠을 때(D8 상한 초과). 다시 만들지 않고 매핑을 놓아준다.
 *
 * 매핑을 남겨두면 취소된 이벤트가 조회 창에 걸려 있는 동안 같은 판정이 반복되고,
 * 다음 정방향 반영이 사라진 이벤트를 patch하려다 실패한다. 매핑을 지우면 그 이벤트는
 * "hub-om 매핑 없음"으로 분류돼 조용히 지나간다.
 *
 * 대가는 캘린더와 운영현황이 어긋난 상태로 남는 것이다. 그건 사람이 hub-om에서
 * 정리하도록 DM으로 넘긴다 — 코드가 사람의 판단을 계속 되돌리지 않는다.
 *
 * 되살리는 경로는 회차 모양에 따라 다르다. 구간이 여러 개면 다른 매핑이 남아 있어서
 * 운영현황에서 교육일을 저장하면 정방향 반영이 그 구간을 다시 만든다. 구간이 하나뿐이면
 * 매핑이 전부 없어져 정방향 반영이 손대지 않으므로(매핑 0건 + 수정 = 기능 도입 전 과정),
 * 캘린더에서는 취소된 것과 같은 상태로 남는다.
 */
async function abandonEvent(item: ReverseSyncItem): Promise<string> {
  await deleteCalendarEventLink(item.operationId, item.eventDate);
  console.warn(
    `[gcal-reverse] ${item.operationId} 복구 중단: ${item.eventDate} 이벤트를 다시 만들지 않고 매핑을 지웠습니다` +
      ` (event=${item.eventId})`
  );

  const notified = await notifyOm(item, abandonedText(item));

  return notified ? "복구 중단 + 담당 OM 알림" : "복구 중단 (담당 OM 알림 실패/대상 없음)";
}

function sessionLabel(item: ReverseSyncItem): string {
  return `${item.companyName} / ${item.courseName}${item.roundNo ? ` ${item.roundNo}회차` : ""}`;
}

function recreatedText(item: ReverseSyncItem): string {
  return (
    ":arrows_counterclockwise: *캘린더에서 삭제된 일정을 복구했습니다.*\n" +
    `*과정* ${sessionLabel(item)}\n` +
    `*교육일* ${item.eventDate}\n` +
    "회차 취소는 hub-om 운영현황에서 해주세요. 캘린더에서는 날짜·시간만 수정하실 수 있습니다."
  );
}

function abandonedText(item: ReverseSyncItem): string {
  return (
    ":warning: *캘린더 일정이 다시 삭제되어 복구를 멈췄습니다.*\n" +
    `*과정* ${sessionLabel(item)}\n` +
    `*교육일* ${item.eventDate}\n` +
    "이 교육일은 캘린더에 없는 상태로 남습니다.\n" +
    "회차를 취소하시려면 hub-om 운영현황에서 처리해주세요. " +
    "일정이 그대로 필요하시면 운영현황에서 교육일을 다시 저장해주세요."
  );
}

/**
 * 담당 OM에게 DM으로 알린다. 마무리 알림과 같은 발송 경로를 쓴다.
 *
 * 복구했으면 이벤트가 다시 존재해서, 복구를 중단했으면 매핑이 없어져서 —
 * 어느 쪽이든 다음 실행의 대상이 아니다. 같은 DM이 반복되지 않는다.
 */
async function notifyOm(item: ReverseSyncItem, text: string): Promise<boolean> {
  try {
    const names = splitPersonNames(item.omName, "").filter((name) => name.trim());
    if (names.length === 0) return false;

    const users = await listTeamUsers();
    let sent = false;
    for (const name of names) {
      const key = normalizePersonName(name);
      const slackId = users.find((user) => normalizePersonName(user.name) === key)?.slackId?.trim();
      if (!slackId) continue;

      if (await sendSlackDirectMessage(slackId, text)) sent = true;
    }

    return sent;
  } catch (error) {
    // 알림 실패로 재생성·중단 처리 자체를 실패로 만들지 않는다.
    console.error(`[gcal-reverse] ${item.operationId} 알림 실패:`, error);
    return false;
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
