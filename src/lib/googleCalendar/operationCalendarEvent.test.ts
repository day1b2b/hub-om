import assert from "node:assert/strict";
import { test } from "node:test";

import type { OperationSession } from "@/lib/data/operationTypes";
import {
  attendeesChanged,
  buildCalendarEventBody,
  buildEventSummary,
  nextDay,
  parseTimeRange
} from "@/lib/googleCalendar/operationCalendarEvent.ts";
import { extractPartKey, resolvePartCalendarId } from "@/lib/googleCalendar/calendarWriteConfig.ts";

// 필수 필드만 채운 최소 운영 레코드. 각 테스트에서 필요한 값만 덮어쓴다.
function operationFixture(overrides: Partial<OperationSession> = {}): OperationSession {
  return {
    operationId: "OP-1",
    companyName: "롯데정밀화학",
    courseName: "AI 업무 효율화",
    roundNo: "2",
    startDate: "2026-09-07",
    endDate: "2026-09-07",
    timeText: "09:00 ~ 18:00",
    region: "서울 사업장",
    om: "김정선",
    onsiteOm: "",
    instructors: "",
    ...overrides
  } as OperationSession;
}

test("parseTimeRange는 구분자가 달라도 시작·종료 시각을 읽는다", () => {
  assert.deepEqual(parseTimeRange("09:00 ~ 18:00"), { start: "09:00", end: "18:00" });
  assert.deepEqual(parseTimeRange("09:00-13:00"), { start: "09:00", end: "13:00" });
  assert.deepEqual(parseTimeRange("9:00~13:30"), { start: "09:00", end: "13:30" });
});

test("parseTimeRange는 못 읽거나 뒤집힌 시간을 null로 돌려준다", () => {
  assert.equal(parseTimeRange(""), null);
  assert.equal(parseTimeRange("오전 반나절"), null);
  // 종료가 시작보다 이르면 표기 오류로 보고 종일 일정으로 떨어뜨린다.
  assert.equal(parseTimeRange("18:00 ~ 09:00"), null);
});

test("nextDay는 월말에도 하루를 더한다", () => {
  assert.equal(nextDay("2026-09-07"), "2026-09-08");
  assert.equal(nextDay("2026-09-30"), "2026-10-01");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
});

test("buildEventSummary는 노션 기입 규칙과 같은 표기를 만든다", () => {
  assert.equal(buildEventSummary(operationFixture()), "[롯데정밀화학] AI 업무 효율화_2회차");
  // 이미 "회차"가 붙어 있으면 중복해서 붙이지 않는다.
  assert.equal(
    buildEventSummary(operationFixture({ roundNo: "3회차" })),
    "[롯데정밀화학] AI 업무 효율화_3회차"
  );
  assert.equal(
    buildEventSummary(operationFixture({ roundNo: "" })),
    "[롯데정밀화학] AI 업무 효율화"
  );
});

test("1파트는 [강의관리] 기업명_과정명_N회차 표기를 쓴다", () => {
  assert.equal(
    buildEventSummary(operationFixture(), "1파트"),
    "[강의관리] 롯데정밀화학_AI 업무 효율화_2회차"
  );
  // 파트 값은 사용자 소속 팀 표기("AX 1파트")로도 들어온다. 캘린더 선택과 같은 규칙으로 읽는다.
  assert.equal(
    buildEventSummary(operationFixture(), "AX 1파트"),
    "[강의관리] 롯데정밀화학_AI 업무 효율화_2회차"
  );
  // 회차 표기 규칙은 기존과 같다.
  assert.equal(
    buildEventSummary(operationFixture({ roundNo: "3회차" }), "1파트"),
    "[강의관리] 롯데정밀화학_AI 업무 효율화_3회차"
  );
  assert.equal(
    buildEventSummary(operationFixture({ roundNo: "" }), "1파트"),
    "[강의관리] 롯데정밀화학_AI 업무 효율화"
  );
});

test("1파트가 아니면 제목 표기가 바뀌지 않는다", () => {
  for (const part of ["2파트", "3파트", "AX 2파트", "", null, undefined]) {
    assert.equal(
      buildEventSummary(operationFixture(), part),
      "[롯데정밀화학] AI 업무 효율화_2회차",
      `파트=${String(part)}`
    );
  }
});

test("buildCalendarEventBody가 파트를 제목까지 전달한다", () => {
  const part1 = buildCalendarEventBody(operationFixture(), [], "1파트");
  assert.equal(part1.summary, "[강의관리] 롯데정밀화학_AI 업무 효율화_2회차");

  // 파트를 넘기지 않으면(=파트를 못 정한 경우) 기존 표기를 유지한다.
  const fallback = buildCalendarEventBody(operationFixture(), []);
  assert.equal(fallback.summary, "[롯데정밀화학] AI 업무 효율화_2회차");
});

test("시간 표기가 있으면 시각 지정 일정이 된다", () => {
  const body = buildCalendarEventBody(operationFixture(), ["om@day1company.co.kr"]);

  assert.deepEqual(body.start, { dateTime: "2026-09-07T09:00:00", timeZone: "Asia/Seoul" });
  assert.deepEqual(body.end, { dateTime: "2026-09-07T18:00:00", timeZone: "Asia/Seoul" });
  assert.equal(body.location, "서울 사업장");
  assert.deepEqual(body.attendees, [{ email: "om@day1company.co.kr" }]);
});

test("시간 표기가 없으면 종일 일정이 되고 종료일은 배타적이다", () => {
  const body = buildCalendarEventBody(
    operationFixture({ timeText: "", startDate: "2026-09-07", endDate: "2026-09-08" }),
    []
  );

  assert.deepEqual(body.start, { date: "2026-09-07" });
  assert.deepEqual(body.end, { date: "2026-09-09" });
  // 참석자가 없으면 attendees 자체를 넣지 않는다(빈 배열은 기존 참석자를 지운다).
  assert.equal(body.attendees, undefined);
});

test("게스트는 일정을 고칠 수 있지만 참석자를 늘릴 수는 없다 (D6)", () => {
  // guestsCanModify는 역반영 스케줄이 돌고 있을 때만 켜져 있어야 한다. 이 테스트는 그 상태를 고정한다 —
  // 스케줄을 끄면서 이 값을 false로 되돌릴 때는 이 테스트도 같이 바꿔야 한다.
  for (const body of [
    buildCalendarEventBody(operationFixture(), ["om@day1company.co.kr"], "1파트"),
    buildCalendarEventBody(operationFixture({ timeText: "" }), [])
  ]) {
    assert.equal(body.guestsCanModify, true);
    assert.equal(body.guestsCanInviteOthers, false);
  }
});

test("resolvePartCalendarId는 파트 키로 캘린더를 찾는다", () => {
  const previous = process.env.GOOGLE_CAL_PART_CALENDARS;
  process.env.GOOGLE_CAL_PART_CALENDARS = "1파트:one@group.calendar.google.com,2파트:two@group.calendar.google.com";

  try {
    // 멤버 관리의 "AX 1파트" 표기도 같은 캘린더로 붙는다.
    assert.equal(resolvePartCalendarId("AX 1파트"), "one@group.calendar.google.com");
    assert.equal(resolvePartCalendarId("2파트"), "two@group.calendar.google.com");
    // 매핑에 없는 파트는 빈 문자열이라 호출부에서 반영을 건너뛴다.
    assert.equal(resolvePartCalendarId("3파트"), "");
    assert.equal(resolvePartCalendarId(null), "");
  } finally {
    process.env.GOOGLE_CAL_PART_CALENDARS = previous;
  }
});

test("extractPartKey는 두 표기에서 같은 키를 뽑는다", () => {
  assert.equal(extractPartKey("AX 1파트"), "1파트");
  assert.equal(extractPartKey("3파트"), "3파트");
  assert.equal(extractPartKey("영업팀"), null);
  assert.equal(extractPartKey(null), null);
});

// ── 참석자 변화 판정 (초대 메일 발송 여부) ────────────────────────
test("참석자가 늘면 달라진 것으로 본다", () => {
  assert.equal(attendeesChanged([], ["a@day1company.co.kr"]), true);
  assert.equal(attendeesChanged(["a@day1company.co.kr"], ["a@day1company.co.kr", "b@day1company.co.kr"]), true);
});

test("같은 사람이 담당·현장을 겸해도 목록이 그대로면 달라지지 않았다", () => {
  assert.equal(attendeesChanged(["a@day1company.co.kr"], ["a@day1company.co.kr"]), false);
  assert.equal(attendeesChanged(["a@day1company.co.kr"], ["a@day1company.co.kr", "a@day1company.co.kr"]), false);
});

test("순서와 대소문자 차이는 무시한다", () => {
  assert.equal(
    attendeesChanged(["b@day1company.co.kr", "a@day1company.co.kr"], ["A@day1company.co.kr", "B@day1company.co.kr"]),
    false
  );
});

test("참석자가 빠지면 달라진 것으로 본다", () => {
  assert.equal(attendeesChanged(["a@day1company.co.kr", "b@day1company.co.kr"], ["a@day1company.co.kr"]), true);
});

test("이벤트를 못 읽었으면(null) 메일을 다시 보내지 않는다", () => {
  assert.equal(attendeesChanged(null, ["a@day1company.co.kr"]), false);
});
