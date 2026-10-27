import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContractPrefillUrl } from "./instructorContractPrefill";

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
