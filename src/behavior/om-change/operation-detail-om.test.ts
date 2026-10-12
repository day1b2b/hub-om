// 기획서: specs/om-change.spec.md — 입구 `POST /api/operations/[operationId]/drive-import/apply`
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import type { UpdateOperationInput } from "@/lib/data/operationTypes";
import { installSlackFake, omRequest, withLinkedOmRequest } from "../fakes/omAssignmentFake";

const ENTRANCE = "POST /api/operations/[operationId]/drive-import/apply";
let authorized = true;
let currentOm = "기존 OM";
const updates: UpdateOperationInput[] = [];

await installSlackFake();
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
mock.module("@/lib/auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => {
  if (!authorized) throw new Error("unauthorized");
  return { user: { email: "member@example.invalid" } };
} } });
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => ({
  getOperationById: async () => ({ operationId: "op-1", om: currentOm }),
  updateOperation: async (_id: string, input: UpdateOperationInput) => { updates.push(input); return input; }
}) } });
const { POST } = await import("@/app/api/operations/[operationId]/drive-import/apply/route");
const changeOm = (om: string) => withLinkedOmRequest(async () => {
  const response = await POST(new Request("http://localhost/api/operations/op-1/drive-import/apply", {
    method: "POST", body: JSON.stringify({ patches: [{ field: "om", value: om }] })
  }), { params: Promise.resolve({ operationId: "op-1" }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
});

beforeEach(() => { authorized = true; currentOm = "기존 OM"; updates.length = 0; omRequest.reset(); });

test(`운영 상세에서 OM을 바꾸면 업무요청 담당자도 같은 값이 된다 [spec:om-change R1 | ${ENTRANCE}]`, async () => {
  await changeOm("새 OM");
  assert.deepEqual(updates, [{ om: "새 OM" }]);
  assert.deepEqual(omRequest.syncCalls, [["op-1", "새 OM"]]);
});

test(`운영 상세에서 새 OM을 정하면 Slack 접수 스레드에 배정 댓글을 단다 [spec:om-change R2 | ${ENTRANCE}]`, async () => {
  await changeOm("새 OM");
  assert.equal(omRequest.slackMessages.length, 1);
  assert.equal(omRequest.slackMessages[0].assignedOm, "새 OM");
  assert.equal(omRequest.slackMessages[0].threadTs, "thread-ts");
});

test(`같은 담당자 재저장과 미배정 값은 Slack 알림을 보내지 않는다 [spec:om-change R3 | ${ENTRANCE}]`, async () => {
  await changeOm("기존 OM");
  await changeOm("");
  await changeOm("배정필요");
  assert.equal(omRequest.slackMessages.length, 0);
});

test(`Slack 알림이 실패해도 OM 변경은 저장된다 [spec:om-change R4 | ${ENTRANCE}]`, async () => {
  omRequest.slackFails = true;
  const result = await changeOm("새 OM");
  assert.equal(result.body.ok, true);
  assert.deepEqual(updates, [{ om: "새 OM" }]);
});

test(`로그인하지 않으면 OM을 바꿀 수 없다 [spec:om-change R5 | ${ENTRANCE}]`, async () => {
  authorized = false;
  await assert.rejects(changeOm("새 OM"), /unauthorized/);
  assert.deepEqual(updates, []);
  assert.equal(omRequest.slackMessages.length, 0);
});
