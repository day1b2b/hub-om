import assert from "node:assert/strict";
import { test } from "node:test";

import { groupInstructorCourses, type InstructorCourse } from "@/features/wiki/instructorWikiModel.ts";

function round(overrides: Partial<InstructorCourse>): InstructorCourse {
  return {
    operationId: "op",
    companyName: "가나전자",
    courseName: "AI 리터러시",
    roundNo: "1",
    role: "강사",
    status: "완료",
    startDate: "",
    endDate: "",
    om: "",
    educationFormat: "",
    region: "",
    avgSatisfaction: "",
    instructorSatisfaction: "",
    instructorWikiLink: "",
    ...overrides
  };
}

test("groupInstructorCourses: 같은 과정의 회차를 한 줄로 묶고 최초 투입일·강의/강사 만족도 평균을 낸다", () => {
  const groups = groupInstructorCourses([
    round({ operationId: "op-3", courseRecordId: "c1", startDate: "2026-09-10", avgSatisfaction: "5.0", instructorSatisfaction: "4.8", om: "김OM" }),
    round({ operationId: "op-1", courseRecordId: "c1", startDate: "2026-06-10", avgSatisfaction: "4.0", instructorSatisfaction: "4.6", om: "김OM" }),
    round({ operationId: "op-2", courseRecordId: "c1", startDate: "2026-07-10", om: "이OM" }),
    round({ operationId: "op-9", companyName: "다라금융", courseName: "업무자동화", startDate: "2026-07-01", role: "실습코치" })
  ]);

  assert.equal(groups.length, 2);
  const [latest, older] = groups;
  // 최초 투입일 최신순: 다라금융(7.1)이 가나전자(6.10)보다 위.
  assert.equal(latest.companyName, "다라금융");
  assert.deepEqual(latest.roles, ["실습코치"]);
  assert.equal(older.roundCount, 3);
  assert.equal(older.firstDate, "2026-06-10");
  // 과정 상세 링크는 가장 이른 회차로 간다.
  assert.equal(older.operationId, "op-1");
  assert.equal(older.courseSatisfaction?.toFixed(1), "4.5"); // 강의(전체): (5.0+4.0)/2
  assert.equal(older.instructorSatisfaction?.toFixed(1), "4.7"); // 강사: (4.8+4.6)/2
  assert.deepEqual(older.oms, ["김OM", "이OM"]);
});

test("groupInstructorCourses: Course.id가 없으면 기업+과정명으로 묶고, 날짜 없는 과정은 맨 뒤", () => {
  const groups = groupInstructorCourses([
    round({ operationId: "a", courseName: "[부가세 별도] 데이터 기초" }),
    round({ operationId: "b", courseName: "데이터 기초", startDate: "2026-02-14" }),
    round({ operationId: "c", courseName: "날짜 없음" })
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].roundCount, 2);
  assert.equal(groups[0].firstDate, "2026-02-14");
  assert.equal(groups[1].firstDate, "");
});
