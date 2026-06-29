import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isCoachPiiViewer } from "./coachPiiViewer.ts";

const ORIGINAL = process.env.ADMIN_EMAILS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = ORIGINAL;
});

test("ADMIN_EMAILS가 비어 있으면 아무도 PII를 볼 수 없다 (fail-closed)", () => {
  delete process.env.ADMIN_EMAILS;
  assert.equal(isCoachPiiViewer("someone@day1company.co.kr"), false);

  process.env.ADMIN_EMAILS = "";
  assert.equal(isCoachPiiViewer("someone@day1company.co.kr"), false);
});

test("ADMIN_EMAILS 목록에 있는 워크스페이스 계정만 허용", () => {
  process.env.ADMIN_EMAILS = "admin@day1company.co.kr";
  assert.equal(isCoachPiiViewer("admin@day1company.co.kr"), true);
  assert.equal(isCoachPiiViewer("ADMIN@day1company.co.kr"), true); // 대소문자 무시
  assert.equal(isCoachPiiViewer("other@day1company.co.kr"), false);
});

test("ADMIN_EMAILS에 있어도 워크스페이스 도메인이 아니면 거부", () => {
  process.env.ADMIN_EMAILS = "attacker@gmail.com";
  assert.equal(isCoachPiiViewer("attacker@gmail.com"), false);
});

test("이메일이 없으면 거부", () => {
  process.env.ADMIN_EMAILS = "admin@day1company.co.kr";
  assert.equal(isCoachPiiViewer(null), false);
  assert.equal(isCoachPiiViewer(undefined), false);
});
