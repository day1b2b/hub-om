import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContractPrefillUrl, DEPARTMENT_CHOICE_BY_TEAM, resolveDepartmentChoice } from "./instructorContractPrefill";

test("모든 값으로 프리필 URL을 만든다(인코딩 포함)", () => {
  const url = buildContractPrefillUrl({
    courseId: "238061",
    courseName: "AI Essential Plus",
    instructorName: "김진태",
    schedule: "2026.08.25 (화) 09:00~17:00",
    manager: "안유진",
    email: "jin@example.com"
  });
  assert.ok(url.startsWith("https://docs.google.com/forms/d/e/1FAIpQLSf7IQkqglf-Z0uP90WoHLSJoEBP-lnYmQ3HeielXh0c5qSF_Q/viewform"));
  const u = new URL(url);
  assert.equal(u.searchParams.get("usp"), "pp_url");
  assert.equal(u.searchParams.get("entry.1145840833"), "238061");
  assert.equal(u.searchParams.get("entry.207260427"), "AI Essential Plus");
  assert.equal(u.searchParams.get("entry.767785093"), "김진태");
  assert.equal(u.searchParams.get("entry.1208608124"), "2026.08.25 (화) 09:00~17:00");
  assert.equal(u.searchParams.get("entry.349088038"), "안유진");
  assert.equal(u.searchParams.get("entry.842558702"), "jin@example.com");
});

test("이메일이 없으면 이메일 칸은 생략한다(폼에서 수동)", () => {
  const u = new URL(buildContractPrefillUrl({ courseId: "1", courseName: "c", instructorName: "n", schedule: "s", manager: "m" }));
  assert.equal(u.searchParams.get("entry.842558702"), null);
  assert.equal(u.searchParams.get("entry.767785093"), "n");
});

test("빈 문자열 값은 파라미터에 넣지 않는다", () => {
  const u = new URL(buildContractPrefillUrl({ courseId: "238061", courseName: "", instructorName: "n", schedule: "  ", manager: "m" }));
  assert.equal(u.searchParams.get("entry.207260427"), null); // 빈 코스명
  assert.equal(u.searchParams.get("entry.1208608124"), null); // 공백 일정
  assert.equal(u.searchParams.get("entry.1145840833"), "238061");
});

test("소속 및 부서장: 담당 OM 파트로 보기를 고르고, 못 찾거나 갈리면 비운다", () => {
  const teams = { 홍길동: "AX 1파트", 김철수: "AX 1파트", 이영희: "AX 3파트", 박온라인: "AX 온라인" };
  assert.equal(resolveDepartmentChoice("홍길동", teams), DEPARTMENT_CHOICE_BY_TEAM["AX 1파트"]);
  assert.equal(resolveDepartmentChoice("홍길동, 김철수", teams), DEPARTMENT_CHOICE_BY_TEAM["AX 1파트"]);
  assert.equal(resolveDepartmentChoice("홍길동, 이영희", teams), "");
  assert.equal(resolveDepartmentChoice("모르는사람", teams), "");
  assert.equal(resolveDepartmentChoice("박온라인", teams), "");
  assert.equal(resolveDepartmentChoice("", teams), "");
});

test("소속 및 부서장 보기는 라디오 프리필 entry로 넣고, 비면 생략한다", () => {
  const base = { courseId: "1", courseName: "c", instructorName: "n", schedule: "s", manager: "m" };
  const choice = DEPARTMENT_CHOICE_BY_TEAM["AX 2파트"];
  assert.equal(new URL(buildContractPrefillUrl({ ...base, department: choice })).searchParams.get("entry.195171543"), choice);
  assert.equal(new URL(buildContractPrefillUrl({ ...base, department: "" })).searchParams.get("entry.195171543"), null);
});
