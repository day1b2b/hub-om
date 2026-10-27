import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstructorContractRequests, formatSchedule } from "./instructorContractRequests";
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

test("운영현황 표기에 소속 접두사가 붙어도 정규화해 상태를 맞춘다", () => {
  const items = buildInstructorContractRequests(
    [op({ courseId: "238061", instructors: "디노랩스_김진태" })],
    [contract({ courseId: "238061", instructorName: "김진태" })]
  );
  assert.equal(items[0].instructorName, "디노랩스_김진태"); // 표시는 원래 표기
  assert.equal(items[0].requested, true); // 상태는 정규화 매칭
});
