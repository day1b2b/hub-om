import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSurveyCommentDigest, commentsByCourseGroup } from "@/features/wiki/instructorSurveyComments.ts";
import { courseGroupKey, type InstructorCourse } from "@/features/wiki/instructorWikiModel.ts";
import type { SessionSurveyResult } from "@/lib/data/sessionSurveyResultTypes.ts";

function course(operationId: string, startDate: string, extra: Partial<InstructorCourse> = {}): InstructorCourse {
  return {
    operationId,
    courseRecordId: `course-${operationId}`,
    companyName: "가나식품",
    courseName: "마케팅 AI",
    roundNo: "1회차",
    role: "강사",
    status: "완료" as InstructorCourse["status"],
    startDate,
    endDate: startDate,
    om: "",
    educationFormat: "",
    region: "",
    avgSatisfaction: "",
    instructorSatisfaction: "",
    instructorWikiLink: "",
    ...extra
  };
}

function result(operationId: string, comments: SessionSurveyResult["comments"], respondents: number | null = 20): SessionSurveyResult {
  return {
    operationId,
    recordId: null,
    overall: "4.6",
    instructorSatisfaction: null,
    respondents,
    positiveRate: "95",
    comments,
    appliedBy: null,
    appliedAt: "2026-10-30T00:00:00.000Z"
  };
}

const ok = (positive: string[], improve: string[] = []) => ({ status: "ok" as const, positive, improve });

test("요약: 최근 과정 3개에서 갈래마다 과정당 2줄씩, 출처와 함께", () => {
  const courses = ["a", "b", "c", "d"].map((id, index) => course(id, `2026-0${index + 5}-10`, { companyName: `기업${id}` }));
  const results = courses.map((item) => result(item.operationId, ok([`${item.operationId}1`, `${item.operationId}2`, `${item.operationId}3`], [`${item.operationId} 개선`])));
  const digest = buildSurveyCommentDigest(courses, results);
  assert.equal(digest.courseCount, 3);
  const positive = digest.lines.filter((line) => line.kind === "positive");
  assert.deepEqual(positive.map((line) => line.text), ["d1", "d2", "c1", "c2", "b1", "b2"]);
  assert.equal(positive[0].source, "기업d 8.10");
  assert.equal(digest.lines.filter((line) => line.kind === "improve").length, 3);
  assert.deepEqual(digest.counts, { ok: 4, no_subjective: 0, no_summary: 0 });
});

test("요약: 같은 과정의 여러 회차는 가장 최근 회차 요약만, 실습코치 회차와 구버전 기록은 뺀다", () => {
  const courses = [
    course("r1", "2026-07-01", { courseRecordId: "same" }),
    course("r2", "2026-07-08", { courseRecordId: "same" }),
    course("coach", "2026-07-09", { role: "실습코치" }),
    course("legacy", "2026-07-10")
  ];
  const digest = buildSurveyCommentDigest(courses, [
    result("r1", ok(["옛 회차"])),
    result("r2", ok(["새 회차"])),
    result("coach", ok(["코치 회차"])),
    result("legacy", null)
  ]);
  assert.deepEqual(digest.lines.map((line) => line.text), ["새 회차"]);
  assert.deepEqual(digest.counts, { ok: 2, no_subjective: 0, no_summary: 0 });
});

test("요약: 주관식 없는 설문·요약 없이 반영은 줄 없이 개수만 센다", () => {
  const courses = [course("x", "2026-08-01"), course("y", "2026-08-02"), course("z", "2026-08-03")];
  const digest = buildSurveyCommentDigest(courses, [
    result("x", { status: "no_subjective", positive: [], improve: [] }),
    result("y", { status: "no_summary", positive: [], improve: [] }),
    result("z", ok([], []))
  ]);
  assert.deepEqual(digest.lines, []);
  assert.equal(digest.courseCount, 0);
  assert.deepEqual(digest.counts, { ok: 1, no_subjective: 1, no_summary: 1 });
});

test("투입 이력: 과정 묶음 키로 회차 코멘트를 날짜순으로 묶는다", () => {
  const first = course("r1", "2026-07-08", { courseRecordId: "same", roundNo: "2회차" });
  const second = course("r2", "2026-07-01", { courseRecordId: "same", roundNo: "1회차" });
  const groups = commentsByCourseGroup([first, second, course("none", "2026-07-02")], [
    result("r1", ok(["좋음"])),
    result("r2", { status: "no_subjective", positive: [], improve: [] }, null)
  ]);
  const rounds = groups.get(courseGroupKey(first));
  assert.deepEqual(rounds?.map((round) => [round.roundNo, round.status, round.respondents]), [["1회차", "no_subjective", null], ["2회차", "ok", 20]]);
  assert.equal(groups.size, 1);
});
