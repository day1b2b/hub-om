import assert from "node:assert/strict";
import test from "node:test";
import { coachLinkedSession } from "../data/coachLinkedSession";
import { coachEngagementEduType, formatEduTime } from "./coachEngagementEduType";

const engagement = (linkedSession: ReturnType<typeof coachLinkedSession>, startTime: string | null = null, endTime: string | null = null) =>
  ({ linkedSession, startTime, endTime });

test("회차와 연결되지 않은 투입은 유형을 비워 둔다(시간이 있어도 추정하지 않는다)", () => {
  assert.deepEqual(coachEngagementEduType(engagement(null, "09:00", "13:00")), { linked: false });
});

test("회차의 교육형태와 회차 시간으로 하루 교육 시간을 계산한다", () => {
  const eduType = coachEngagementEduType(engagement({ educationFormat: "PBL", timeText: "09:00 ~ 18:00" }, "08:30", "18:30"));
  assert.deepEqual(eduType, { linked: true, formatLabel: "PBL", time: { start: "09:00", end: "18:00", hours: 9, source: "session" } });
});

test("회차 시간이 비었거나 못 읽으면 투입 시간으로 계산하고 출처를 남긴다", () => {
  const eduType = coachEngagementEduType(engagement({ educationFormat: "오프라인", timeText: "오전" }, "13:00", "17:30"));
  assert.deepEqual(eduType, { linked: true, formatLabel: "오프라인", time: { start: "13:00", end: "17:30", hours: 4.5, source: "engagement" } });
});

test("시간 표기는 간격을 시간 단위로 붙인다", () => {
  assert.equal(formatEduTime({ start: "13:00", end: "17:30", hours: 4.5, source: "engagement" }), "13:00~17:30 · 4.5시간");
  assert.equal(formatEduTime({ start: "09:00", end: "18:00", hours: 9, source: "session" }), "09:00~18:00 · 9시간");
});

test("시간을 어디서도 못 읽으면 형태만 보여준다", () => {
  assert.deepEqual(coachEngagementEduType(engagement({ educationFormat: "해커톤", timeText: null })), { linked: true, formatLabel: "해커톤", time: null });
});

test("검토필요 형태는 확인 필요로 보여준다", () => {
  const eduType = coachEngagementEduType(engagement({ educationFormat: "검토필요", timeText: "9:00-13:00" }));
  assert.deepEqual(eduType, { linked: true, formatLabel: "교육형태 확인 필요", time: { start: "09:00", end: "13:00", hours: 4, source: "session" } });
});

test("회차 행을 화면 값으로 바꾸고, 지워진 회차·알 수 없는 형태를 다룬다", () => {
  assert.deepEqual(coachLinkedSession({ educationFormat: "HACKATHON", timeText: " 10:00~16:00 ", deletedAt: null }), { educationFormat: "해커톤", timeText: "10:00~16:00" });
  assert.deepEqual(coachLinkedSession({ educationFormat: "OFFLINE", timeText: "  " }), { educationFormat: "오프라인", timeText: null });
  assert.equal(coachLinkedSession({ educationFormat: "PBL", deletedAt: new Date("2026-01-01") }), null);
  assert.equal(coachLinkedSession(null), null);
  assert.deepEqual(coachLinkedSession({ educationFormat: "UNKNOWN" }), { educationFormat: "검토필요", timeText: null });
});
