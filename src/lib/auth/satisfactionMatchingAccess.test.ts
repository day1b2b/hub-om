import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { Session } from "next-auth";

const originalEnabled = process.env.SATISFACTION_MATCHING_ENABLED;
const adminSession: Session = { user: { email: "admin@day1company.co.kr" }, expires: "" };
const assertAdmin = mock.fn(async (): Promise<Session> => adminSession);

mock.module("./requireAdminSession.ts", {
  namedExports: { assertAdminSession: assertAdmin }
});

const { authorizeSatisfactionMatching, isSatisfactionMatchingEnabled } = await import("./satisfactionMatchingAccess.ts");

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.SATISFACTION_MATCHING_ENABLED;
  else process.env.SATISFACTION_MATCHING_ENABLED = originalEnabled;
  assertAdmin.mock.resetCalls();
  assertAdmin.mock.mockImplementation(async () => adminSession);
});

test("미설정·false·잘못된 설정은 관리자 확인 전에 404로 닫힌다", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    if (value === undefined) delete process.env.SATISFACTION_MATCHING_ENABLED;
    else process.env.SATISFACTION_MATCHING_ENABLED = value;

    assert.equal(isSatisfactionMatchingEnabled(), false);
    const access = await authorizeSatisfactionMatching();
    assert.equal(access.ok, false);
    if (access.ok) assert.fail("꺼진 기능에 접근할 수 없어야 한다");
    assert.equal(access.response.status, 404);
  }
  assert.equal(assertAdmin.mock.callCount(), 0);
});

test("명시적으로 켜도 관리자 인증에 실패하면 403으로 거부한다", async () => {
  process.env.SATISFACTION_MATCHING_ENABLED = "true";
  assertAdmin.mock.mockImplementation(async () => {
    throw new Error("admin 권한이 필요합니다.");
  });

  const access = await authorizeSatisfactionMatching();
  assert.equal(access.ok, false);
  if (access.ok) assert.fail("일반 직원은 접근할 수 없어야 한다");
  assert.equal(access.response.status, 403);
  assert.equal(assertAdmin.mock.callCount(), 1);
});

test("명시적으로 켜고 관리자이면 기존 기능에서 쓸 세션을 돌려준다", async () => {
  process.env.SATISFACTION_MATCHING_ENABLED = "true";

  const access = await authorizeSatisfactionMatching();
  assert.equal(access.ok, true);
  if (!access.ok) assert.fail("관리자의 재사용을 허용해야 한다");
  assert.equal(access.session, adminSession);
});

test("다시 끄면 이전 요청이 허용됐어도 다음 요청은 차단한다", async () => {
  process.env.SATISFACTION_MATCHING_ENABLED = "true";
  assert.equal((await authorizeSatisfactionMatching()).ok, true);

  process.env.SATISFACTION_MATCHING_ENABLED = "false";
  const access = await authorizeSatisfactionMatching();
  assert.equal(access.ok, false);
  if (access.ok) assert.fail("다시 끈 기능은 접근할 수 없어야 한다");
  assert.equal(access.response.status, 404);
  assert.equal(assertAdmin.mock.callCount(), 1);
});
