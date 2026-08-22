import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCourseLookup, selectCoursesByCompany, selectCoursesByCourseId } from "@/lib/data/courseLookup";
import type { CourseLookupRow } from "@/lib/data/courseLookup";
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

// ── selectCoursesByCourseId — 원문이 아니라 정규화 기준으로 골라내는지 ──────────

function row(courseId: string, companyName: string, courseName: string, latestStartDate: null | string = null): CourseLookupRow {
  return { courseId, companyName, courseName, latestStartDate };
}

test("코스ID가 같은 과정만 골라낸다", () => {
  const picked = selectCoursesByCourseId(
    [row("260455", "삼성전자DX", "AI Essential Plus"), row("260456", "KT", "다른 과정")],
    "260455"
  );

  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.courseName, "AI Essential Plus");
  assert.equal(picked[0]?.courseId, "260455");
});

test("코스ID에 제로폭 문자가 섞여 있어도 찾는다 — 원문 비교면 놓친다", () => {
  const picked = selectCoursesByCourseId([row("2604\u200b55", "삼성전자DX", "AI Essential Plus")], "260455");

  assert.equal(picked.length, 1, "제로폭 문자가 섞인 과정을 놓쳤다");
  assert.equal(picked[0]?.courseId, "260455", "돌려주는 코스ID는 정규화된 값이어야 한다");
});

test("엑셀에서 온 .0 꼬리가 붙어 있어도 찾는다", () => {
  const picked = selectCoursesByCourseId([row("260455.0", "삼성전자DX", "AI Essential Plus")], "260455");

  assert.equal(picked.length, 1);
});

test("앞뒤 공백이 있어도 찾는다", () => {
  assert.equal(selectCoursesByCourseId([row("  260455 ", "KT", "과정")], "260455").length, 1);
});

test("부분만 겹치는 코스ID는 고르지 않는다", () => {
  const picked = selectCoursesByCourseId(
    [row("1260455", "KT", "앞에 붙음"), row("2604550", "KT", "뒤에 붙음")],
    "260455"
  );

  assert.equal(picked.length, 0);
});

test("target이 비면 아무것도 고르지 않는다", () => {
  assert.deepEqual(selectCoursesByCourseId([row("260455", "KT", "과정")], ""), []);
});

test("최근 회차가 있는 과정을 앞에, 회차 없는 과정을 뒤에 둔다", () => {
  const picked = selectCoursesByCourseId(
    [
      row("260455", "KT", "회차 없음"),
      row("260455", "KT", "옛 회차", "2026-01-05"),
      row("260455", "KT", "최근 회차", "2026-08-01")
    ],
    "260455"
  );

  assert.deepEqual(
    picked.map((candidate) => candidate.courseName),
    ["최근 회차", "옛 회차", "회차 없음"]
  );
});

// ── selectCoursesByCompany — 코스ID를 모를 때 고객사명으로 찾는 역방향 조회 ──────

const COMPANY_ROWS: CourseLookupRow[] = [
  row("260455", "삼성전자DX", "AI Essential Plus", "2026-07-22"),
  row("260812", "삼성전자DX", "데이터 리터러시 기본", "2026-06-10"),
  row("259901", "삼성전자 DX부문", "AI 활용 심화", "2026-03-14"),
  row("260759", "KT", "AX 오픈클래스_Claude", "2026-07-30"),
  row("262915", "KT", "하네스엔지니어링 후속교육", "2026-08-03"),
  row("", "삼성전자DX", "코스ID 미등록 과정", "2026-08-01")
];

test("고객사명 일부만 쳐도 그 고객사 과정이 나온다", () => {
  const picked = selectCoursesByCompany(COMPANY_ROWS, "삼성", "", 20);

  assert.deepEqual(picked.map((c) => c.courseName),
    ["코스ID 미등록 과정", "AI Essential Plus", "데이터 리터러시 기본", "AI 활용 심화"]);
});

test("최근 회차가 있는 과정이 앞에 온다", () => {
  const picked = selectCoursesByCompany(COMPANY_ROWS, "KT", "", 20);

  assert.deepEqual(picked.map((c) => c.courseId), ["262915", "260759"]);
});

test("과정명 조각으로 더 좁힐 수 있다", () => {
  const picked = selectCoursesByCompany(COMPANY_ROWS, "삼성", "리터러시", 20);

  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.courseId, "260812");
});

test("코스ID가 아직 안 채워진 과정도 후보에 넣는다 — 감추면 왜 안 보이는지 알 수 없다", () => {
  const picked = selectCoursesByCompany(COMPANY_ROWS, "삼성전자DX", "", 20);

  const unregistered = picked.find((c) => c.courseName === "코스ID 미등록 과정");
  assert.ok(unregistered, "코스ID 없는 과정이 빠졌다");
  assert.equal(unregistered?.courseId, "");
});

test("대소문자·연속 공백·제로폭 문자를 무시하고 찾는다", () => {
  assert.equal(selectCoursesByCompany(COMPANY_ROWS, "  삼성전자dx  ", "", 20).length, 3);
  assert.equal(selectCoursesByCompany(COMPANY_ROWS, "삼성\u200b전자DX", "", 20).length, 3);
});

test("limit보다 하나 더 돌려준다 — 호출자가 '더 있음'을 알 수 있게", () => {
  const picked = selectCoursesByCompany(COMPANY_ROWS, "삼성", "", 2);

  assert.equal(picked.length, 3, "limit+1개를 돌려줘야 잘렸는지 판단할 수 있다");
});

test("고객사명이 비면 아무것도 돌려주지 않는다 — 전체를 쏟지 않는다", () => {
  assert.deepEqual(selectCoursesByCompany(COMPANY_ROWS, "", "", 20), []);
  assert.deepEqual(selectCoursesByCompany(COMPANY_ROWS, "   ", "", 20), []);
});

test("찾는 고객사가 없으면 빈 목록", () => {
  assert.deepEqual(selectCoursesByCompany(COMPANY_ROWS, "없는회사", "", 20), []);
});
