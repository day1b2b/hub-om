import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstructorRows } from "./instructorWikiRows";
import type { InstructorCourse, InstructorWikiEntry } from "./instructorWikiModel";

const TODAY = "2026-06-01";

function course(partial: Partial<InstructorCourse> = {}): InstructorCourse {
  return {
    operationId: "op",
    companyName: "회사",
    courseName: "과정",
    roundNo: "1",
    role: "강사",
    status: "완료",
    startDate: "2026-01-01",
    endDate: "2026-01-02",
    om: "",
    educationFormat: "",
    region: "",
    avgSatisfaction: "",
    instructorSatisfaction: "",
    instructorWikiLink: "",
    ...partial
  };
}

function entry(partial: Partial<InstructorWikiEntry> = {}): InstructorWikiEntry {
  return {
    id: "id-1",
    name: "홍길동",
    companies: [],
    courseCount: partial.courses?.length ?? 0,
    courses: [],
    coach: null,
    categories: [],
    ...partial
  };
}

function row(e: InstructorWikiEntry) {
  return buildInstructorRows([e], [], TODAY, 6)[0];
}

test("전문분야: 노션 카테고리가 있으면 노션 우선(강사 정본, 상세와 동일)", () => {
  const r = row(
    entry({
      coach: { coachId: "c", status: "active", workType: null, fields: ["A", "B"], avgRating: null, curriculums: [] },
      categories: ["X", "Y", "Z"]
    })
  );
  assert.deepEqual(r.fields, ["X", "Y", "Z"]);
});

test("전문분야: 노션 카테고리가 없으면 코치 DB로 폴백", () => {
  assert.deepEqual(
    row(
      entry({
        coach: { coachId: "c", status: "active", workType: null, fields: ["A"], avgRating: null, curriculums: [] },
        categories: []
      })
    ).fields,
    ["A"]
  );
  assert.deepEqual(row(entry({ categories: [], coach: null })).fields, []);
});

test("만족도: 3건 미만이면 평균을 숨기고 건수만(정렬 왜곡 방지)", () => {
  const r = row(entry({ courses: [course({ avgSatisfaction: "4.8" }), course({ avgSatisfaction: "4.6" })] }));
  assert.equal(r.rating, null);
  assert.equal(r.ratingLabel, "(2건)");
});

test("만족도: 3건 이상이면 평균과 건수 표기", () => {
  const r = row(
    entry({
      courses: [course({ avgSatisfaction: "4.8" }), course({ avgSatisfaction: "4.6" }), course({ avgSatisfaction: "4.0" })]
    })
  );
  assert.equal(r.rating !== null, true);
  assert.equal(r.ratingLabel, "4.5 (3건)");
});

test("만족도: 집계할 점수가 없으면 '-'", () => {
  const r = row(entry({ courses: [course({ avgSatisfaction: "" })] }));
  assert.equal(r.rating, null);
  assert.equal(r.ratingLabel, "-");
});
