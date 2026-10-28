import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInstructorContractRequests,
  formatSchedule,
  resolveInstructorContractStatus
} from "./instructorContractRequests";
import type { InstructorContractRecord } from "./instructorContractSheet";

function op(overrides: {
  instructors?: string;
  courseId?: string;
  courseName?: string;
  om?: string;
  educationDates?: string[];
  startDate?: string;
  endDate?: string;
  timeText?: string;
}) {
  return {
    instructors: "",
    courseId: "",
    courseName: "",
    om: "",
    educationDates: [] as string[],
    startDate: "",
    endDate: "",
    timeText: "",
    ...overrides
  };
}
function contract(partial: Partial<InstructorContractRecord>): InstructorContractRecord {
  return { courseId: "", instructorName: "", email: "", contractSent: false, contractCompleted: false, ...partial };
}

test("formatSchedule: 교육일 + 시간대", () => {
  assert.equal(formatSchedule(["2026-08-25", "2026-08-26"], "09:00~17:00"), "2026.08.25, 2026.08.26 · 09:00~17:00");
  assert.equal(formatSchedule([], ""), "");
  assert.equal(formatSchedule(["2026-08-25"], ""), "2026.08.25");
});

test("회차별 강사를 각각 대상으로 만든다", () => {
  const items = buildInstructorContractRequests(
    [
      op({ courseId: "238061", courseName: "AI", instructors: "김진태", om: "유진", educationDates: ["2026-08-25"], timeText: "09:00~17:00" }),
      op({ courseId: "238061", courseName: "AI", instructors: "이영희", om: "유진", educationDates: ["2026-09-01"], timeText: "09:00~17:00" })
    ],
    []
  );
  assert.equal(items.length, 2);
  const kim = items.find((i) => i.instructorName === "김진태");
  assert.equal(kim?.courseId, "238061");
  assert.equal(kim?.manager, "유진");
  assert.equal(kim?.schedule, "2026.08.25 · 09:00~17:00");
  assert.equal(kim?.requested, false);
});

test("같은 강사의 여러 회차는 1건으로 묶고 일정을 합친다", () => {
  const items = buildInstructorContractRequests(
    [
      op({ courseId: "238061", instructors: "김진태", educationDates: ["2026-08-26"] }),
      op({ courseId: "238061", instructors: "김진태", educationDates: ["2026-08-25"] })
    ],
    []
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].schedule, "2026.08.25, 2026.08.26"); // 정렬·병합
});

test("응답시트에 (코스ID×강사)가 있으면 requested=true", () => {
  const items = buildInstructorContractRequests(
    [op({ courseId: "238061", instructors: "김진태" })],
    [contract({ courseId: "238061", instructorName: "김진태" })]
  );
  assert.equal(items[0].requested, true);
});

test("응답시트(Q열)에 이메일이 있으면 강사명으로 찾아 붙인다", () => {
  const items = buildInstructorContractRequests(
    [op({ courseId: "238061", instructors: "디노랩스_김진태" })],
    [
      // 다른 과정의 과거 계약이라도 같은 강사면 이메일을 가져온다(정규화 매칭).
      contract({ courseId: "100000", instructorName: "김진태", email: "" }),
      contract({ courseId: "100001", instructorName: "김진태", email: "jin@example.com" })
    ]
  );
  assert.equal(items[0].email, "jin@example.com"); // 뒤쪽 비지 않은 값
  assert.equal(items[0].requested, false); // 이 과정(238061)으로는 아직 요청 전
});

test("응답시트에 이메일이 없으면 email은 생략된다(폼 수동)", () => {
  const items = buildInstructorContractRequests([op({ courseId: "238061", instructors: "신규강사" })], []);
  assert.equal(items[0].email, undefined);
});

test("운영현황 표기에 소속 접두사가 붙어도 정규화해 상태를 맞춘다", () => {
  const items = buildInstructorContractRequests(
    [op({ courseId: "238061", instructors: "디노랩스_김진태" })],
    [contract({ courseId: "238061", instructorName: "김진태" })]
  );
  assert.equal(items[0].instructorName, "디노랩스_김진태"); // 표시는 원래 표기
  assert.equal(items[0].requested, true); // 상태는 정규화 매칭
});

test("resolveInstructorContractStatus: 쌍마다 requested·email을 돌려주고 표기는 그대로 유지", () => {
  const results = resolveInstructorContractStatus(
    [
      contract({ courseId: "238061", instructorName: "김진태", email: "jin@example.com" }),
      contract({ courseId: "999999", instructorName: "이영희", email: "lee@example.com" })
    ],
    [
      { courseId: "238061", instructorName: "디노랩스_김진태" }, // 소속 접두사 → 정규화 매칭
      { courseId: "238061", instructorName: "이영희" }, // 이메일은 있지만 이 코스로는 미요청
      { courseId: "238061", instructorName: "신규강사" } // 시트에 없음
    ]
  );
  const kim = results.find((r) => r.instructorName === "디노랩스_김진태");
  assert.equal(kim?.requested, true);
  assert.equal(kim?.email, "jin@example.com");
  assert.equal(kim?.courseId, "238061"); // 받은 값 그대로 echo

  const lee = results.find((r) => r.instructorName === "이영희");
  assert.equal(lee?.requested, false); // 238061로는 요청 전
  assert.equal(lee?.email, "lee@example.com"); // 이메일은 코스 무관하게 강사명으로 조회

  const newbie = results.find((r) => r.instructorName === "신규강사");
  assert.equal(newbie?.requested, false);
  assert.equal(newbie?.email, undefined);
});

test("resolveInstructorContractStatus: 빈 강사명 쌍은 안전하게 미요청·이메일 없음", () => {
  const results = resolveInstructorContractStatus([], [{ courseId: "238061", instructorName: "  " }]);
  assert.equal(results[0].requested, false);
  assert.equal(results[0].email, undefined);
});

test("동명이인(소속 접두사 다른 2명)은 별개 항목으로 남는다(병합 누락 방지)", () => {
  const items = buildInstructorContractRequests(
    [
      op({ courseId: "238061", instructors: "디노랩스_김진태" }),
      op({ courseId: "238061", instructors: "패스트캠퍼스_김진태" })
    ],
    []
  );
  assert.equal(items.length, 2);
  assert.ok(items.some((i) => i.instructorName === "디노랩스_김진태"));
  assert.ok(items.some((i) => i.instructorName === "패스트캠퍼스_김진태"));
});

test("이메일이 동명이인으로 서로 다르면 모호로 보고 비운다(틀린 이메일 프리필 방지)", () => {
  // 코스매칭 레코드가 없고, '김진태' 이름으로 서로 다른 이메일이 둘 → 비움.
  const ambiguous = resolveInstructorContractStatus(
    [
      contract({ courseId: "100", instructorName: "김진태", email: "a@x.com" }),
      contract({ courseId: "200", instructorName: "패스트캠퍼스_김진태", email: "b@y.com" })
    ],
    [{ courseId: "238061", instructorName: "김진태" }]
  );
  assert.equal(ambiguous[0].email, undefined);

  // 코스매칭 레코드가 자기 이메일을 가지면 동명이인이 있어도 그 값을 쓴다.
  const courseMatched = resolveInstructorContractStatus(
    [
      contract({ courseId: "238061", instructorName: "김진태", email: "a@x.com" }),
      contract({ courseId: "200", instructorName: "패스트캠퍼스_김진태", email: "b@y.com" })
    ],
    [{ courseId: "238061", instructorName: "김진태" }]
  );
  assert.equal(courseMatched[0].email, "a@x.com");
  assert.equal(courseMatched[0].requested, true);
});

test("시트 코스ID에 '.0'이 붙어도 정규화해 요청됨을 맞춘다", () => {
  const results = resolveInstructorContractStatus(
    [contract({ courseId: "238061.0", instructorName: "김진태", email: "jin@example.com" })],
    [{ courseId: "238061", instructorName: "김진태" }]
  );
  assert.equal(results[0].requested, true); // 238061.0 ↔ 238061
  assert.equal(results[0].email, "jin@example.com");
});
