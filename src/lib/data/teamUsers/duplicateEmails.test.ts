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
