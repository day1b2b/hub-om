import assert from "node:assert/strict";
import test from "node:test";
import { omRequestInputError } from "./omRequestInputValidation";

const valid = { team: "1파트", ld: "Synthetic LD", company: "Synthetic", courseName: "Synthetic course", sessions: [{ date: "2026-10-20" }] };

test("empty or malformed requests are rejected before saving", () => {
  for (const body of [null, "x", {}, { ...valid, team: " " }, { ...valid, company: undefined }]) assert.ok(omRequestInputError(body));
  assert.match(omRequestInputError({})!, /구분, LD, 기업명, 과정명/);
  assert.match(omRequestInputError({ ...valid, sessions: [] })!, /1회차 이상/);
  assert.match(omRequestInputError({ ...valid, sessions: [{ date: "2026-10-20" }, { date: "" }] })!, /2회차 교육일/);
});

test("complete requests pass, including date text only sessions", () => {
  assert.equal(omRequestInputError(valid), null);
  assert.equal(omRequestInputError({ ...valid, sessions: [{ date: "", educationDatesText: "2026-10-20, 2026-10-21" }] }), null);
});
