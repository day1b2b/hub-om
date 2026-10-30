import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commentStatusFromRecord,
  commentStatusToRecord,
  parseRespondents,
  parseSurveyComments,
  SURVEY_COMMENT_MAX_CHARS,
  SURVEY_COMMENT_MAX_LINES
} from "@/lib/data/sessionSurveyResultTypes";

test("코멘트: comment_status 키가 없으면 undefined(저장된 코멘트 유지)", () => {
  assert.equal(parseSurveyComments({ overall: "4.5" }), undefined);
  assert.equal(parseSurveyComments({ comment_status: null }), undefined);
});

test("코멘트: 약속과 다른 상태·배열 아닌 목록은 invalid", () => {
  assert.equal(parseSurveyComments({ comment_status: "done" }), "invalid");
  assert.equal(parseSurveyComments({ comment_status: "ok", comment_positive: "실습이 유용함" }), "invalid");
});

test("코멘트: ok는 빈 줄·문자열 아닌 값을 빼고, 줄 수·글자 수를 자른다", () => {
  const long = "가".repeat(SURVEY_COMMENT_MAX_CHARS + 20);
  const many = Array.from({ length: SURVEY_COMMENT_MAX_LINES + 3 }, (_, index) => `의견 ${index}`);
  const parsed = parseSurveyComments({ comment_status: "ok", comment_positive: ["  실습이   유용함 ", "", null, 3, long], comment_improve: many });
  assert.ok(parsed && parsed !== "invalid");
  assert.equal(parsed.positive[0], "실습이 유용함");
  assert.equal(parsed.positive.length, 2);
  assert.equal(parsed.positive[1].length, SURVEY_COMMENT_MAX_CHARS);
  assert.ok(parsed.positive[1].endsWith("…"));
  assert.equal(parsed.improve.length, SURVEY_COMMENT_MAX_LINES);
});

test("코멘트: ok인데 목록이 비어 있어도 ok, ok가 아니면 목록을 비운다", () => {
  assert.deepEqual(parseSurveyComments({ comment_status: "ok", comment_positive: [], comment_improve: [] }), { status: "ok", positive: [], improve: [] });
  assert.deepEqual(parseSurveyComments({ comment_status: "no_subjective", comment_positive: ["남은 값"] }), { status: "no_subjective", positive: [], improve: [] });
  assert.deepEqual(parseSurveyComments({ comment_status: "no_summary" }), { status: "no_summary", positive: [], improve: [] });
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
