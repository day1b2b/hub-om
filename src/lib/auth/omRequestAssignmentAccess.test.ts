import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { hasOmRequestAssignmentOverride, omRequestManagerName } from "@/lib/data/omRequest/omRequestTypes";

type Member = { name: string; email: string };
let members: Member[] = [];
let fail = false;
const list = mock.fn(async () => { if (fail) throw new Error("fixture failure"); return members; });
mock.module("@/lib/data/teamUsers/teamUserRepository", { namedExports: { listTeamUsers: list } });
const { canManageOmRequestAssignment } = await import("./omRequestAssignmentAccess");
const managerName = omRequestManagerName("1파트")!;
beforeEach(() => { members = [{ name: managerName, email: "fixture.manager@day1company.co.kr" }]; fail = false; list.mock.resetCalls(); });

test("승인된 파트 관리자와 유일하게 연결된 세션 이메일만 허용한다", async () => {
  assert.equal(await canManageOmRequestAssignment("1파트", " FIXTURE.MANAGER@day1company.co.kr "), true);
  assert.equal(await canManageOmRequestAssignment("AX 1파트", "fixture.manager@day1company.co.kr"), true);
  assert.equal(await canManageOmRequestAssignment("1파트", "ordinary@day1company.co.kr"), false);
  assert.equal(await canManageOmRequestAssignment("2파트", "fixture.manager@day1company.co.kr"), false);
});

test("익명·외부·비정상 이메일과 알 수 없는 팀은 명단 조회 전 거절한다", async () => {
  for (const email of [null, undefined, "", "outside@example.test", "a@b@day1company.co.kr", "a b@day1company.co.kr"]) {
    assert.equal(await canManageOmRequestAssignment("1파트", email), false);
  }
  for (const team of ["", "unknown", "fake1파트", "1파트2파트", "AX 1파트 관리자"]) {
    assert.equal(await canManageOmRequestAssignment(team, "fixture.manager@day1company.co.kr"), false);
  }
  assert.equal(list.mock.callCount(), 0);
});

test("이름/이메일 중복, 미등록, 조회 실패는 권한을 추정하지 않는다", async () => {
  const email = "fixture.manager@day1company.co.kr";
  for (const roster of [[], [{ name: managerName, email }, { name: managerName, email: "other@day1company.co.kr" }],
    [{ name: managerName, email }, { name: "fixture-other", email: email.toUpperCase() }],
    [{ name: managerName, email: "outside@example.test" }]]) {
    members = roster;
    assert.equal(await canManageOmRequestAssignment("1파트", email), false);
  }
  fail = true;
  assert.equal(await canManageOmRequestAssignment("1파트", email), false);
});

test("기존 명시 승인 override만 보존하고 unknown team에서는 사용하지 않는다", async () => {
  // 기존 정책의 계정을 읽어 테스트한다. 테스트에 실제 계정 값을 복제하지 않는다.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../data/omRequest/omRequestTypes.ts", import.meta.url), "utf8");
  const approved = JSON.parse(source.match(/OM_REQUEST_ASSIGN_OVERRIDE_EMAILS = (\[[^;]+\]);/)![1]) as string[];
  assert.ok(approved.length > 0);
  members = [];
  for (const email of approved) {
    assert.equal(hasOmRequestAssignmentOverride(email), true);
    assert.equal(await canManageOmRequestAssignment("1파트", email), true);
    assert.equal(await canManageOmRequestAssignment("unmapped", email), false);
  }
  assert.equal(hasOmRequestAssignmentOverride("ordinary@day1company.co.kr"), false);
  assert.equal(list.mock.callCount(), 0);
});
