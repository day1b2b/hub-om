import { test } from "node:test";
import assert from "node:assert/strict";
import { isRevealableField } from "./piiReveal";

test("isRevealableField: 코치 당사자 PII 필드만 허용", () => {
  for (const field of ["employeeId", "phone", "email", "birthDate", "affiliation"]) {
    assert.equal(isRevealableField("coach", field), true, field);
  }
});

test("isRevealableField: 강사 당사자 PII 필드만 허용", () => {
  for (const field of ["contact", "contact2", "email", "email2", "birthDate"]) {
    assert.equal(isRevealableField("instructor", field), true, field);
  }
});

test("isRevealableField: 시스템/비허용 필드·엔티티는 차단", () => {
  assert.equal(isRevealableField("coach", "coachId"), false); // 연결 키
  assert.equal(isRevealableField("coach", "accessToken"), false); // 토큰
  assert.equal(isRevealableField("coach", "name"), false); // 공개 필드
  assert.equal(isRevealableField("instructor", "instructorNoteId"), false); // 연결 키
  assert.equal(isRevealableField("instructor", "notes"), false); // 노트는 PII 열람 대상 아님
  assert.equal(isRevealableField("instructor", "affiliation"), false); // 강사 소속은 암호화 대상 아님
  assert.equal(isRevealableField("company", "email"), false); // 미지원 엔티티
  assert.equal(isRevealableField("", "phone"), false);
  assert.equal(isRevealableField("coach", ""), false);
  assert.equal(isRevealableField(null, null), false);
  assert.equal(isRevealableField("coach", 123), false);
});
