import assert from "node:assert/strict";
import { test } from "node:test";

import type { OperationSession } from "@/lib/data/operationTypes";
import type { TeamUser } from "@/lib/data/teamUsers/teamUserTypes.ts";
import { planCalendarBackfill } from "@/lib/googleCalendar/backfillCalendarEventsRules.ts";

const CAL = { "1파트": "cal-1", "2파트": "cal-2", "3파트": "cal-3" } as const;

function resolveCalendarId(partKey: string | null): string {
  if (partKey === "1파트") return CAL["1파트"];
  if (partKey === "2파트") return CAL["2파트"];
  if (partKey === "3파트") return CAL["3파트"];
  return "";
}

function user(overrides: Partial<TeamUser> = {}): TeamUser {
  return {
    id: overrides.id ?? "u-1",
    name: overrides.name ?? "조경수",
    email: overrides.email ?? "kyoungsu.cho@day1company.co.kr",
    slackId: overrides.slackId ?? "U1",
    team: overrides.team ?? "AX 3파트",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function operationFixture(overrides: Partial<OperationSession> = {}): OperationSession {
  return {
    operationId: "OP-1",
    companyName: "유한킴벌리",
    courseName: "AI&업무자동화교육 심화(전사)",
    roundNo: "1",
    om: "조경수",
    onsiteOm: "조경수",
    operationStatus: "배정예정",
    startDate: "2026-09-07",
    endDate: "2026-09-28",
    timeText: "10:00 ~ 17:00",
    region: "서울",
    educationDates: ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"],
    ...overrides
  } as OperationSession;
}

test("매핑이 없는 예정 회차는 교육일 구간마다 이벤트를 계획한다", () => {
  const plan = planCalendarBackfill({
    operations: [operationFixture()],
    mappedDatesByOperation: new Map(),
    users: [user()],
    from: "2026-09-07",
    resolveCalendarId,
    writableCalendarIds: null
  });

  assert.equal(plan.inScope, 1);
  assert.equal(plan.alreadyComplete, 0);
  assert.equal(plan.items.length, 1);

  const item = plan.items[0];
  assert.equal(item.status, "planned");
  assert.equal(item.partKey, "3파트");
  assert.equal(item.calendarId, "cal-3");
  assert.deepEqual(
    item.plans.map((p) => p.eventDate),
    ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]
  );
});

test("교육일이 없는 회차는 소급에서 제외한다(기간 통블록 방지)", () => {
  const plan = planCalendarBackfill({
    // endDate는 미래라 날짜 기준엔 들지만, 교육일이 비어 기간 통블록이 될 회차
    operations: [operationFixture({ educationDates: [] })],
    mappedDatesByOperation: new Map(),
    users: [user()],
    from: "2026-09-07",
    resolveCalendarId,
    writableCalendarIds: null
  });

  assert.equal(plan.inScope, 1);
  assert.equal(plan.excludedNoEducationDates, 1);
  assert.equal(plan.items.length, 0);
});

test("이미 매핑된 교육일은 빼고 빠진 날짜만 계획한다(부분 소급·재실행 안전)", () => {
  const plan = planCalendarBackfill({
    operations: [operationFixture()],
    mappedDatesByOperation: new Map([["OP-1", new Set(["2026-09-07", "2026-09-14"])]]),
    users: [user()],
    from: "2026-09-07",
    resolveCalendarId,
    writableCalendarIds: null
  });

  assert.equal(plan.items.length, 1);
  assert.deepEqual(
    plan.items[0].plans.map((p) => p.eventDate),
    ["2026-09-21", "2026-09-28"]
  );
});

test("모든 교육일이 매핑돼 있으면 계획 없이 alreadyComplete로만 센다", () => {
  const plan = planCalendarBackfill({
    operations: [operationFixture()],
    mappedDatesByOperation: new Map([
      ["OP-1", new Set(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"])]
    ]),
    users: [user()],
    from: "2026-09-07",
    resolveCalendarId,
    writableCalendarIds: null
  });

  assert.equal(plan.inScope, 1);
  assert.equal(plan.alreadyComplete, 1);
  assert.equal(plan.items.length, 0);
});

test("마지막 교육일이 기준일보다 이르면 지난 회차로 보고 제외한다", () => {
  const plan = planCalendarBackfill({
    operations: [operationFixture({ educationDates: ["2026-04-01", "2026-04-02"] })],
    mappedDatesByOperation: new Map(),
    users: [user()],
    from: "2026-09-07",
    resolveCalendarId,
    writableCalendarIds: null
  });

  assert.equal(plan.inScope, 0);
  assert.equal(plan.items.length, 0);
});

test("담당 OM의 팀에서 파트를 못 뽑으면 파트 캘린더 없음으로 건너뛴다(2파트 원인 b 진단)", () => {
  const plan = planCalendarBackfill({
    operations: [operationFixture({ om: "김민진", onsiteOm: "김민진" })],
    mappedDatesByOperation: new Map(),
    users: [user({ name: "김민진", email: "minjin@day1company.co.kr", team: "영업지원" })],
    from: "2026-09-07",
    resolveCalendarId,
    writableCalendarIds: null
  });

  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].status, "skipped");
  assert.equal(plan.items[0].partKey, null);
  assert.match(plan.items[0].skipReason ?? "", /파트 캘린더를 찾지 못함/);
});

test("적용 실행에서 쓰기 불가 캘린더는 권한 없음으로 건너뛴다(2파트 원인 a 방어)", () => {
  const plan = planCalendarBackfill({
    operations: [operationFixture({ om: "정수아", onsiteOm: "정수아" })],
    mappedDatesByOperation: new Map(),
    users: [user({ name: "정수아", email: "sua@day1company.co.kr", team: "AX 2파트" })],
    from: "2026-09-07",
    resolveCalendarId,
    // cal-2(2파트)는 쓰기 가능 목록에 없다 → 편집 권한 미공유 상황
    writableCalendarIds: new Set(["cal-1", "cal-3"])
  });

  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].status, "skipped");
  assert.equal(plan.items[0].partKey, "2파트");
  assert.match(plan.items[0].skipReason ?? "", /쓰기 권한 없음/);
});

test("dryRun처럼 writableCalendarIds가 null이면 권한과 무관하게 계획에 남긴다", () => {
  const plan = planCalendarBackfill({
    operations: [operationFixture({ om: "정수아", onsiteOm: "정수아" })],
    mappedDatesByOperation: new Map(),
    users: [user({ name: "정수아", email: "sua@day1company.co.kr", team: "AX 2파트" })],
    from: "2026-09-07",
    resolveCalendarId,
    writableCalendarIds: null
  });

  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].status, "planned");
  assert.equal(plan.items[0].calendarId, "cal-2");
});
