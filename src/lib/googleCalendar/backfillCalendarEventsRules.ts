// 기능 도입 전에 등록돼 캘린더에 올라간 적이 없는 회차를, 정방향 규칙 그대로 소급 생성한다.
//
// 정방향 반영(reflectOperationToCalendar)은 "운영 생성" 때만 이벤트를 만든다. 그래서 캘린더
// 쓰기 기능이 켜지기 전에 등록된 과정은 구글에 생성된 적이 없고, 이후 수정해도 소급되지 않는다
// (reflectOperation의 `if (existing.length === 0 && trigger === "updated") return;`). refresh-events는
// 이미 매핑된 이벤트의 제목·설명만 다시 쓰므로 없는 이벤트를 만들지 못한다.
//
// 이 모듈은 순수 계획만 세운다(구글 호출·DB 쓰기 없음). 매핑이 없는 교육일만 골라
// 정방향과 같은 buildCalendarEventBodies로 이벤트 본문을 만든다. 실제 insert는 호출부가 한다.

import type { OperationSession } from "@/lib/data/operationTypes";
import type { TeamUser } from "@/lib/data/teamUsers/teamUserTypes";
import { buildCalendarEventBodies, normalizeEducationDates, type CalendarEventPlan } from "./operationCalendarEvent";
import { resolveCalendarTargetsFromUsers } from "./calendarParticipants";

export type BackfillItemStatus = "planned" | "skipped";

export interface BackfillPlanItem {
  operationId: string;
  companyName: string;
  courseName: string;
  roundNo: string;
  om: string;
  onsiteOm: string;
  operationStatus: string;
  partKey: string | null;
  calendarId: string | null;
  /** 회차가 담당하는 마지막 날짜(예정 판정에 쓴 값). */
  lastDate: string | null;
  attendeeEmails: string[];
  unresolvedNames: string[];
  /** 아직 매핑이 없어 새로 만들 이벤트들. skipped면 비어 있다. */
  plans: CalendarEventPlan[];
  status: BackfillItemStatus;
  skipReason?: string;
}

/** 회차가 담당하는 마지막 날짜. 실제 교육일이 있으면 그 최댓값, 없으면 endDate. */
export function operationLastDate(operation: OperationSession): string | null {
  const dates = normalizeEducationDates(operation.educationDates);
  if (dates.length > 0) return dates[dates.length - 1];
  return operation.endDate?.trim() || null;
}

export interface PlanBackfillParams {
  operations: OperationSession[];
  /** 회차별로 이미 구글에 매핑된 교육일(YYYY-MM-DD) 집합. 이 날짜는 다시 만들지 않는다. */
  mappedDatesByOperation: Map<string, Set<string>>;
  users: TeamUser[];
  /** 이 날짜 이후(포함)에 끝나는 회차만 대상으로 한다(YYYY-MM-DD). 지난 회차는 소급하지 않는다. */
  from: string;
  /** 파트 키 → 파트 캘린더 ID. 못 찾으면 빈 문자열. */
  resolveCalendarId: (partKey: string | null) => string;
  /**
   * 지정하면(=적용 실행) 이 집합에 없는 캘린더는 쓰기 불가로 보고 건너뛴다.
   * dryRun 미리보기에서는 null로 두어 권한과 무관하게 "무엇이 빠졌는지"를 다 보여준다.
   */
  writableCalendarIds?: Set<string> | null;
}

export interface BackfillPlan {
  items: BackfillPlanItem[];
  /** 대상 회차(예정)이면서 모든 교육일이 이미 매핑돼 만들 것이 없는 회차 수. */
  alreadyComplete: number;
  /** 날짜 기준 안에 든 회차 수(매핑 유무 무관). */
  inScope: number;
}

/**
 * 소급 대상 계획을 세운다. 매핑이 없는 교육일만 골라 정방향과 같은 규칙으로 이벤트를 만든다.
 * 날짜 단위로 빠진 것만 채우므로, 일부만 만들어진 회차나 재실행에서도 중복이 생기지 않는다.
 */
export function planCalendarBackfill(params: PlanBackfillParams): BackfillPlan {
  const items: BackfillPlanItem[] = [];
  let alreadyComplete = 0;
  let inScope = 0;

  for (const operation of params.operations) {
    const lastDate = operationLastDate(operation);
    // 날짜가 아예 없거나 마지막 날짜가 기준일보다 이르면 지난 회차 → 소급 대상 아님.
    if (!lastDate || lastDate < params.from) continue;
    inScope += 1;

    const targets = resolveCalendarTargetsFromUsers(operation, params.users);
    const calendarId = params.resolveCalendarId(targets.partKey) || null;

    const allPlans = buildCalendarEventBodies(operation, targets.attendeeEmails, targets.partKey);
    const mappedDates = params.mappedDatesByOperation.get(operation.operationId) ?? new Set<string>();
    const missingPlans = allPlans.filter((plan) => plan.eventDate && !mappedDates.has(plan.eventDate));

    // 만들 교육일이 없다 = 이미 다 올라갔거나(전부 매핑) 만들 날짜 자체가 없는 회차.
    if (missingPlans.length === 0) {
      if (allPlans.length > 0) alreadyComplete += 1;
      continue;
    }

    const base = {
      operationId: operation.operationId,
      companyName: operation.companyName,
      courseName: operation.courseName,
      roundNo: operation.roundNo,
      om: operation.om,
      onsiteOm: operation.onsiteOm,
      operationStatus: operation.operationStatus,
      partKey: targets.partKey,
      calendarId,
      lastDate,
      attendeeEmails: targets.attendeeEmails,
      unresolvedNames: targets.unresolvedNames
    };

    if (!calendarId) {
      items.push({
        ...base,
        plans: [],
        status: "skipped",
        skipReason: `파트 캘린더를 찾지 못함(파트=${targets.partKey ?? "없음"})`
      });
      continue;
    }

    if (params.writableCalendarIds && !params.writableCalendarIds.has(calendarId)) {
      items.push({
        ...base,
        plans: [],
        status: "skipped",
        skipReason: `캘린더 쓰기 권한 없음 — B2B 계정에 편집 권한 공유 필요(calId=${calendarId})`
      });
      continue;
    }

    items.push({ ...base, plans: missingPlans, status: "planned" });
  }

  return { items, alreadyComplete, inScope };
}
