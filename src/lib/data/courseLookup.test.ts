import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCourseLookup } from "@/lib/data/courseLookup";
import type { CourseLookupCandidate } from "@/lib/data/operationTypes";

function candidate(companyName: string, courseName: string, latestStartDate: null | string = null): CourseLookupCandidate {
  return { courseId: "123456", companyName, courseName, latestStartDate };
}

test("후보가 없으면 null", () => {
  assert.equal(resolveCourseLookup([]), null);
});

test("후보가 하나면 고객사·과정명 둘 다 채운다", () => {
  const resolved = resolveCourseLookup([candidate("KT", "Gen AI 활용과정", "2026-08-01")]);

  assert.deepEqual(resolved, {
    company: "KT",
    courseName: "Gen AI 활용과정",
    ambiguous: false,
    candidateCount: 1
  });
});

test("후보가 여럿이면 과정명은 채우지 않는다 — 틀린 과정명이 시트까지 흘러가는 것을 막는다", () => {
  const resolved = resolveCourseLookup([
    candidate("KT", "Gen AI 활용과정", "2026-08-01"),
    candidate("KT", "데이터 분석 기초", "2026-07-01")
  ]);

  assert.equal(resolved?.courseName, "");
  assert.equal(resolved?.company, "KT", "고객사가 같으면 고객사는 채운다");
  assert.equal(resolved?.ambiguous, true);
  assert.equal(resolved?.candidateCount, 2);
});

test("후보들의 고객사까지 갈리면 아무것도 채우지 않는다", () => {
  const resolved = resolveCourseLookup([
    candidate("KT", "Gen AI 활용과정", "2026-08-01"),
    candidate("삼성전자", "Gen AI 활용과정", "2026-07-01")
  ]);

  assert.equal(resolved?.company, "");
  assert.equal(resolved?.courseName, "");
  assert.equal(resolved?.ambiguous, true);
});

test("앞뒤 공백은 정리해서 채운다", () => {
  const resolved = resolveCourseLookup([candidate("  KT  ", " Gen AI 활용과정 ")]);

  assert.equal(resolved?.company, "KT");
  assert.equal(resolved?.courseName, "Gen AI 활용과정");
});
