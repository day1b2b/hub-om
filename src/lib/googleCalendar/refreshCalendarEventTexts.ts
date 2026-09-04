// 이미 캘린더에 올라간 이벤트의 **설명·제목만** 현재 규칙으로 다시 쓴다(관리자 도구).
//
// 설명 문구나 제목 규칙이 바뀌면 새 이벤트는 바로 새 규칙을 따르지만, 기존 이벤트는
// hub-om에서 그 회차를 저장할 때까지 옛 문구로 남는다. 회차가 수십 건이면 하나씩 저장할 수
// 없으므로 매핑 전체를 돌며 patch한다(2026-09-04: 설명 머리말 교체 + 운영 상세 링크).
//
// 건드리지 않는 것
//  - 날짜·시간: 매니저가 캘린더에서 옮긴 값이 있을 수 있다. 그건 역반영이 다룬다.
//  - 참석자: 초대를 거절하거나 지운 사람을 다시 초대하지 않는다(D9).
//  - 표식(hubOmSchedule): 날짜·시간을 안 쓰므로 표식도 그대로 둔다.
//  - 메일: patch 기본이 sendUpdates=none이라 참석자에게 아무것도 가지 않는다.
// DB에는 쓰지 않는다.

import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { isCalendarWriteEnabled } from "./calendarWriteConfig";
import { patchEvent } from "./calendarWriteClient";
import { listAllCalendarEventLinks } from "./calendarEventLinkRepository";
import { resolveCalendarTargets } from "./calendarParticipants";
import { buildTextPatch } from "./refreshCalendarEventTextsRules";

export { buildTextPatch } from "./refreshCalendarEventTextsRules";

export type RefreshResultKind = "planned" | "updated" | "missing" | "skipped" | "failed";

export interface RefreshOutcome {
  operationId: string;
  calendarId: string;
  eventId: string;
  eventDate: string;
  result: RefreshResultKind;
  detail?: string;
}

export interface RefreshEventTextsResult {
  ok: boolean;
  enabled: boolean;
  dryRun: boolean;
  total: number;
  counts: Record<RefreshResultKind, number>;
  outcomes: RefreshOutcome[];
  warning?: string;
}

function emptyCounts(): Record<RefreshResultKind, number> {
  return { planned: 0, updated: 0, missing: 0, skipped: 0, failed: 0 };
}

export async function refreshCalendarEventTexts(options: { dryRun: boolean }): Promise<RefreshEventTextsResult> {
  const base: RefreshEventTextsResult = {
    ok: true,
    enabled: true,
    dryRun: options.dryRun,
    total: 0,
    counts: emptyCounts(),
    outcomes: []
  };

  if (!isCalendarWriteEnabled()) {
    return { ...base, enabled: false, warning: "구글 캘린더 연동이 꺼져 있습니다(GOOGLE_CAL_OAUTH_*·GOOGLE_CAL_PART_CALENDARS 확인)." };
  }

  const links = await listAllCalendarEventLinks();
  const operations = new Map(
    (await getOperationRepository().listOperations()).map((operation) => [operation.operationId, operation])
  );
  // 파트(=제목 규칙)는 회차 단위로 정해지므로 회차마다 한 번만 조회한다.
  const partKeyByOperation = new Map<string, string | null>();
  const outcomes: RefreshOutcome[] = [];

  for (const link of links) {
    const outcome: RefreshOutcome = {
      operationId: link.operationId,
      calendarId: link.calendarId,
      eventId: link.eventId,
      eventDate: link.eventDate,
      result: "skipped"
    };
    outcomes.push(outcome);

    const operation = operations.get(link.operationId);
    if (!operation) {
      outcome.detail = "매핑된 회차를 찾지 못함";
      continue;
    }

    if (!partKeyByOperation.has(link.operationId)) {
      partKeyByOperation.set(link.operationId, (await resolveCalendarTargets(operation)).partKey);
    }

    const patch = buildTextPatch(operation, link, partKeyByOperation.get(link.operationId) ?? null);
    if (!patch) {
      outcome.detail = `운영현황에 없는 교육일(${link.eventDate}) — 정방향 반영 대기`;
      continue;
    }

    if (options.dryRun) {
      outcome.result = "planned";
      continue;
    }

    try {
      outcome.result = await patchEvent(link.calendarId, link.eventId, patch);
      if (outcome.result === "missing") outcome.detail = "이벤트가 캘린더에 없음(사람이 지움) — hub-om 저장 시 재생성";
    } catch (error) {
      outcome.result = "failed";
      outcome.detail = error instanceof Error ? error.message : String(error);
      console.error(`[gcal-refresh] ${link.operationId} ${link.eventDate} 설명 갱신 실패:`, outcome.detail);
    }
  }

  const counts = emptyCounts();
  for (const outcome of outcomes) counts[outcome.result] += 1;

  if (!options.dryRun) {
    console.info(
      `[gcal-refresh] 설명·제목 갱신: ${counts.updated}건 갱신, ${counts.missing}건 없음, ${counts.skipped}건 건너뜀, ${counts.failed}건 실패`
    );
  }

  return { ...base, ok: counts.failed === 0, total: links.length, counts, outcomes };
}
