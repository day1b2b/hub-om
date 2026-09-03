// 역반영 계획을 실제로 적용한다(calendarReverseSync.ts가 만든 계획을 받아 실행).
//
// 쓰기 범위를 좁게 고정한다(db-write-safety):
//  - 운영현황에 쓰는 필드는 startDate·endDate·timeText 셋뿐이다.
//  - 대상은 캘린더 매핑이 있는 회차 중 판정이 "운영현황 반영"인 건만이다.
//  - 1회 실행 상한(CALENDAR_REVERSE_SYNC_MAX_APPLY, 기본 20건)을 넘으면 한 건도 적용하지 않는다.
//  - 바꾼 값은 이전값→새값으로 로그에 남긴다([gcal-reverse] 접두어로 Coolify 런타임 로그에서 검색).
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
import { saveCalendarEventLink } from "./calendarEventLinkRepository";
import { buildCalendarEventBody } from "./operationCalendarEvent";
import { planCalendarReverseSync, type ReverseSyncItem, type ReverseSyncPlan } from "./calendarReverseSync";

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

  return recreateEvent(item);
}

/** 캘린더에서 바뀐 날짜·시간을 운영현황에 쓴다. 그 외 필드는 캘린더 쪽을 되돌린다. */
async function applyScheduleToOperation(item: ReverseSyncItem): Promise<string> {
  const change = item.scheduleChange;
  if (!change) throw new Error("날짜·시간 변경 내용이 없습니다.");

  await getOperationRepository().updateOperation(item.operationId, {
    startDate: change.to.startDate,
    endDate: change.to.endDate,
    timeText: change.to.timeText
  });

  const from = `${change.from.startDate}~${change.from.endDate} ${change.from.timeText}`.trim();
  const to = `${change.to.startDate}~${change.to.endDate} ${change.to.timeText}`.trim();
  console.info(`[gcal-reverse] ${item.operationId} 날짜·시간 반영: ${from} → ${to} (event=${item.eventId})`);

  // 사람이 날짜와 함께 제목·장소도 바꿨으면 그 필드만 되돌린다.
  // 날짜·시간은 방금 받아들인 값이므로 patch에 넣지 않는다.
  const revertFields = (item.revertFields ?? []).filter((field) => field !== "날짜·시간");
  if (revertFields.length === 0) return `날짜·시간 반영 (${to})`;

  const operation = await findOperation(item.operationId);
  const expected = buildCalendarEventBody(operation, []);
  await patchEvent(item.calendarId, item.eventId, {
    summary: expected.summary,
    location: expected.location ?? ""
  });
  console.info(`[gcal-reverse] ${item.operationId} ${revertFields.join(", ")} 원복 (event=${item.eventId})`);

  return `날짜·시간 반영 (${to}) + ${revertFields.join(", ")} 원복`;
}

/**
 * 캘린더를 운영현황 값으로 되돌린다.
 * attendees는 절대 함께 보내지 않는다 — 초대를 거절하거나 자기 캘린더에서 지운 사람을
 * 다시 초대하지 않기로 했다(D9).
 */
async function revertEventToOperation(item: ReverseSyncItem): Promise<string> {
  const operation = await findOperation(item.operationId);
  const expected = buildCalendarEventBody(operation, []);

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
  const eventId = await insertEvent(calendarId, buildCalendarEventBody(operation, targets.attendeeEmails));

  await saveCalendarEventLink({ operationId: operation.operationId, calendarId, eventId });
  console.info(`[gcal-reverse] ${item.operationId} 이벤트 재생성: ${item.eventId} → ${eventId}`);

  const notified = await notifyRecreated(item);

  return notified ? "이벤트 재생성 + 담당 OM 알림" : "이벤트 재생성 (담당 OM 알림 실패/대상 없음)";
}

/**
 * 재생성 사실을 담당 OM에게 DM으로 알린다. 마무리 알림과 같은 발송 경로를 쓴다.
 * 재생성하면 이벤트가 다시 존재하므로 다음 실행에서는 대상이 아니다 — 반복 알림이 구조적으로 없다.
 */
async function notifyRecreated(item: ReverseSyncItem): Promise<boolean> {
  try {
    const names = splitPersonNames(item.omName, "").filter((name) => name.trim());
    if (names.length === 0) return false;

    const users = await listTeamUsers();
    const text =
      ":arrows_counterclockwise: *캘린더에서 삭제된 일정을 복구했습니다.*\n" +
      `*과정* ${item.companyName} / ${item.courseName}${item.roundNo ? ` ${item.roundNo}회차` : ""}\n` +
      "회차 취소는 hub-om 운영현황에서 해주세요. 캘린더에서는 날짜·시간만 수정하실 수 있습니다.";

    let sent = false;
    for (const name of names) {
      const key = normalizePersonName(name);
      const slackId = users.find((user) => normalizePersonName(user.name) === key)?.slackId?.trim();
      if (!slackId) continue;

      if (await sendSlackDirectMessage(slackId, text)) sent = true;
    }

    return sent;
  } catch (error) {
    // 알림 실패로 재생성 자체를 실패로 만들지 않는다.
    console.error(`[gcal-reverse] ${item.operationId} 재생성 알림 실패:`, error);
    return false;
  }
}

async function findOperation(operationId: string) {
  const operation = await getOperationRepository().getOperationById(operationId);
  if (!operation) throw new Error(`회차를 찾지 못했습니다(${operationId}).`);

  return operation;
}

function readMaxApply(): number {
  const parsed = Number(process.env.CALENDAR_REVERSE_SYNC_MAX_APPLY?.trim());

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_APPLY;
}
