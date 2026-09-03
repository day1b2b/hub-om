import assert from "node:assert/strict";
import { test } from "node:test";

import { findDuplicateEmails } from "@/lib/data/teamUsers/duplicateEmails.ts";

test("중복이 없으면 빈 배열", () => {
  assert.deepEqual(
    findDuplicateEmails([
      { name: "가온", email: "a@day1company.co.kr" },
      { name: "한빛", email: "b@day1company.co.kr" }
    ]),
    []
  );
});

test("같은 이메일 행을 이름과 함께 묶는다", () => {
  const groups = findDuplicateEmails([
    { name: "가온A", email: "a@day1company.co.kr" },
    { name: "가온", email: "a@day1company.co.kr" },
    { name: "한빛", email: "b@day1company.co.kr" }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].email, "a@day1company.co.kr");
  assert.deepEqual(groups[0].names, ["가온A", "가온"]);
});

test("앞뒤 공백·대소문자만 다른 이메일도 중복으로 본다", () => {
  const groups = findDuplicateEmails([
    { name: "가온", email: " A@Day1Company.co.kr " },
    { name: "가온A", email: "a@day1company.co.kr" }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].email, "a@day1company.co.kr");
});

test("이메일이 빈 행은 서로 중복으로 묶지 않는다", () => {
  assert.deepEqual(findDuplicateEmails([{ name: "가온", email: "" }, { name: "한빛", email: "  " }]), []);
});

test("여러 중복 그룹을 이메일 순으로 돌려준다", () => {
  const groups = findDuplicateEmails([
    { name: "나", email: "b@x.kr" },
    { name: "가", email: "a@x.kr" },
    { name: "가2", email: "a@x.kr" },
    { name: "나2", email: "b@x.kr" }
  ]);
  assert.deepEqual(groups.map((g) => g.email), ["a@x.kr", "b@x.kr"]);
});

test("이름이 서로 다른 중복은 namesDiffer가 참", () => {
  const groups = findDuplicateEmails([
    { name: "김정선A", email: "a@x.kr" },
    { name: "김정선", email: "a@x.kr" }
  ]);
  assert.equal(groups[0].namesDiffer, true);
});

test("이름이 같은 중복은 namesDiffer가 거짓", () => {
  // 실데이터: "정수아" 두 줄. 어느 줄이 이겨도 이름이 같아 지금은 대시보드가 비지 않는다.
  const groups = findDuplicateEmails([
    { name: "정수아", email: "s@x.kr" },
    { name: "정수아", email: "s@x.kr" }
  ]);
  assert.equal(groups[0].namesDiffer, false);
  assert.deepEqual(groups[0].names, ["정수아", "정수아"]);
});
