import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commentListsFromRecord,
  commentListsToRecord,
  commentStatusFromRecord,
  commentStatusToRecord,
  parseRespondents,
  parseSurveyComments,
  SURVEY_COMMENT_MAX_CHARS,
  SURVEY_COMMENT_MAX_LINES
} from "@/lib/data/sessionSurveyResultTypes";

test("코멘트: comment_status 키가 없으면 undefined(저장된 코멘트 유지)", () => {
  assert.equal(parseSurveyComments({ overall: "4.5", comment_positive: ["무시됨"] }), undefined);
  assert.equal(parseSurveyComments({ comment_status: null }), undefined);
});

test("코멘트: 약속과 다른 상태·배열 아닌 목록은 invalid", () => {
  assert.equal(parseSurveyComments({ comment_status: "done" }), "invalid");
  assert.equal(parseSurveyComments({ comment_status: "ok", comment_hrd_improve: "냉방" }), "invalid");
});

test("코멘트: survey_analysis 네 키를 네 갈래로 받는다", () => {
  assert.deepEqual(parseSurveyComments({
    comment_status: "ok",
    comment_positive: ["실습이 유용함"],
    comment_instructor_improve: ["시간 배분 요청"],
    comment_hrd_improve: ["강의장 냉방"],
    comment_followup: ["심화 과정"]
  }), { status: "ok", positive: ["실습이 유용함"], instructorImprove: ["시간 배분 요청"], hrdImprove: ["강의장 냉방"], followup: ["심화 과정"] });
});

test("코멘트: ok는 빈 줄·문자열 아닌 값을 빼고, 줄 수·글자 수를 자른다", () => {
  const long = "가".repeat(SURVEY_COMMENT_MAX_CHARS + 20);
  const many = Array.from({ length: SURVEY_COMMENT_MAX_LINES + 3 }, (_, index) => `의견 ${index}`);
  const parsed = parseSurveyComments({ comment_status: "ok", comment_positive: ["  실습이   유용함 ", "", null, 3, long], comment_followup: many });
  assert.ok(parsed && parsed !== "invalid");
  assert.equal(parsed.positive[0], "실습이 유용함");
  assert.equal(parsed.positive.length, 2);
  assert.equal(parsed.positive[1].length, SURVEY_COMMENT_MAX_CHARS);
  assert.ok(parsed.positive[1].endsWith("…"));
  assert.equal(parsed.followup.length, SURVEY_COMMENT_MAX_LINES);
  assert.deepEqual(parsed.instructorImprove, []);
});

test("코멘트: ok가 아니면 목록을 비운다", () => {
  assert.deepEqual(parseSurveyComments({ comment_status: "no_subjective", comment_positive: ["남은 값"] }), { status: "no_subjective", positive: [], instructorImprove: [], hrdImprove: [], followup: [] });
});

test("저장 칸(JSON 하나)은 네 갈래로 왕복하고, 모르는 키·깨진 값은 버린다", () => {
  const comments = { status: "ok" as const, positive: ["a"], instructorImprove: [], hrdImprove: ["b"], followup: ["c"] };
  const record = commentListsToRecord(comments);
  assert.equal("status" in record, false);
  assert.deepEqual(commentListsFromRecord(record), { positive: ["a"], instructorImprove: [], hrdImprove: ["b"], followup: ["c"] });
  assert.deepEqual(commentListsFromRecord({ positive: "x", extra: ["y"] }), { positive: [], instructorImprove: [], hrdImprove: [], followup: [] });
  assert.deepEqual(commentListsFromRecord(null), { positive: [], instructorImprove: [], hrdImprove: [], followup: [] });
});

test("상태 저장값은 왕복한다", () => {
  for (const status of ["ok", "no_subjective", "no_summary"] as const) {
    assert.equal(commentStatusFromRecord(commentStatusToRecord(status)), status);
  }
  assert.equal(commentStatusFromRecord(null), null);
  assert.equal(commentStatusFromRecord("ok"), null);
});

test("응답자 수는 정수로, 읽을 수 없으면 null", () => {
  assert.equal(parseRespondents("26.0"), 26);
  assert.equal(parseRespondents(" 7 "), 7);
  assert.equal(parseRespondents(""), null);
  assert.equal(parseRespondents("-3"), null);
});
