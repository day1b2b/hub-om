// 기획서: specs/om-change.spec.md — 입구 `PATCH /api/om-request/assign`
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { installSlackFake, omRequest } from "../fakes/omAssignmentFake";

const ENTRANCE = "PATCH /api/om-request/assign";
let allowed = true;
const writes: Array<[string | null, string]> = [];

await installSlackFake();
mock.module("next/server.js", { namedExports: { NextResponse: { json: (data: unknown, options?: ResponseInit) => Response.json(data, options) } } });
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
mock.module("@/auth", { namedExports: { auth: async () => ({ user: { name: "관리자", email: "manager@example.invalid" } }) } });
mock.module("@/lib/auth/omRequestAssignmentAccess", { namedExports: { canManageOmRequestAssignment: async () => allowed } });
mock.module("@/lib/data/omRequest/omRequestLocalRepository", { namedExports: { getOmRequest: async () => ({
  id: "request-1", assignedOm: omRequest.assignedOm, team: "1파트", company: "기업", courseName: "과정", ld: "LD",
  ldEmail: "ld@example.invalid", slackChannel: "CHANNEL", slackThreadTs: "thread-ts"
}) } });
mock.module("@/lib/data/omRequest/omRequestAssignment", { namedExports: {
  OmAssignmentConflict: class extends Error {},
  previewOmAssignment: async () => ({ token: "token", count: 1, operations: [] }),
  // 업무요청과 연결 회차를 한 트랜잭션으로 바꾸는 저장소 함수(회차 쪽 동기화 자체는 공통 테스트가 본다).
  assignOmRequestAtomically: async (existing: Record<string, unknown>, nextOm: string | null, actor: string) => {
    writes.push([nextOm, actor]);
    omRequest.assignedOm = nextOm;
    return { updated: { ...existing, assignedOm: nextOm }, operationIds: [] };
  }
} });
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => ({ getOperationById: async () => null }) } });
const { PATCH } = await import("@/app/api/om-request/assign/route");
const assign = async (assignedOm: string | null) => {
  const response = await PATCH(new Request("http://localhost/api/om-request/assign", { method: "PATCH", body: JSON.stringify({ id: "request-1", assignedOm, confirmationToken: "token" }) }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

beforeEach(() => { allowed = true; writes.length = 0; omRequest.reset(); });

test(`배정 폼에서 OM을 정하면 업무요청과 연결 회차를 함께 저장한다 [spec:om-change R1 | ${ENTRANCE}]`, async () => {
  assert.equal((await assign("새 OM")).status, 200);
  assert.deepEqual(writes, [["새 OM", "manager@example.invalid"]]);
});

test(`배정 폼에서 새 OM을 정하면 Slack 접수 스레드에 배정 댓글을 단다 [spec:om-change R2 | ${ENTRANCE}]`, async () => {
  await assign("새 OM");
  assert.equal(omRequest.slackMessages.length, 1);
  assert.equal(omRequest.slackMessages[0].assignedOm, "새 OM");
  assert.equal(omRequest.slackMessages[0].threadTs, "thread-ts");
});

test(`같은 담당자 재저장과 배정 취소는 Slack 알림을 보내지 않는다 [spec:om-change R3 | ${ENTRANCE}]`, async () => {
  await assign("기존 OM");
  await assign(null);
  assert.equal(omRequest.slackMessages.length, 0);
});

test(`Slack 알림이 실패해도 배정은 저장된다 [spec:om-change R4 | ${ENTRANCE}]`, async () => {
  omRequest.slackFails = true;
  assert.equal((await assign("새 OM")).status, 200);
  assert.deepEqual(writes, [["새 OM", "manager@example.invalid"]]);
});

test(`파트 담당 관리자가 아니면 배정할 수 없다 [spec:om-change R5 | ${ENTRANCE}]`, async () => {
  allowed = false;
  assert.equal((await assign("새 OM")).status, 403);
  assert.deepEqual(writes, []);
  assert.equal(omRequest.slackMessages.length, 0);
});
