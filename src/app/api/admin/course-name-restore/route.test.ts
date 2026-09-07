import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

let authorized = true;
let serviceError: Error | null = null;
class Conflict extends Error {}
const apply = mock.fn(async (...args: unknown[]) => { void args; if (serviceError) throw serviceError; return { moved: [], skipped: [] }; });
const plan = mock.fn(async () => { if (serviceError) throw serviceError; return { snapshot: "a".repeat(64) }; });
mock.module("@/lib/auth/requireAdminSession", { namedExports: { assertAdminSession: async () => {
  if (!authorized) throw new Error("denied"); return { user: { email: "admin@example.test" } };
} } });
mock.module("@/lib/data/courseNameRestore", { namedExports: {
  applyCourseNameRestore: apply, planCourseNameRestore: plan, CourseNameRestoreConflict: Conflict
} });
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
const { GET, POST } = await import("./route");
const valid = { courseId: "123", operationIds: ["op1"], snapshot: "a".repeat(64) };
const post = (value: unknown) => POST(new Request("http://localhost/test", { method: "POST", body: JSON.stringify(value) }));
beforeEach(() => { authorized = true; serviceError = null; apply.mock.resetCalls(); plan.mock.resetCalls(); });

test("관리자가 아니면 조회와 쓰기 모두 서비스 호출 전에 거절한다", async () => {
  authorized = false;
  assert.equal((await GET(new Request("http://localhost/test?courseId=123"))).status, 403);
  assert.equal((await post(valid)).status, 403);
  assert.equal(plan.mock.callCount(), 0); assert.equal(apply.mock.callCount(), 0);
});
test("null·잘못된 타입·중복·건수 초과·누락된 계획은 400이고 쓰지 않는다", async () => {
  for (const body of [null, [], { ...valid, courseId: 123 }, { ...valid, courseId: "\u200b" },
    { ...valid, operationIds: [] }, { ...valid, operationIds: [null] }, { ...valid, operationIds: ["op1", "op1"] },
    { ...valid, operationIds: Array.from({ length: 101 }, (_, i) => `op${i}`) }, { ...valid, snapshot: "" }]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal(apply.mock.callCount(), 0);
});
test("잘못된 JSON과 실제 32KiB 초과 본문은 400·413이고 쓰지 않는다", async () => {
  assert.equal((await POST(new Request("http://localhost/test", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await post({ ...valid, extra: "x".repeat(33_000) })).status, 413);
  assert.equal(apply.mock.callCount(), 0);
});
test("관리자·선택 목록·계획을 전달하고 충돌은 409, 내부 오류는 노출하지 않는다", async () => {
  assert.equal((await post(valid)).status, 200);
  assert.deepEqual(apply.mock.calls[0].arguments, ["123", ["op1"], valid.snapshot, "admin@example.test"]);
  serviceError = new Conflict("다시 조회해 주세요."); assert.equal((await post(valid)).status, 409);
  serviceError = new Error("private-db-details");
  for (const response of [await post(valid), await GET(new Request("http://localhost/test?courseId=123"))]) {
    assert.equal(response.status, 500); assert.ok(!(await response.text()).includes("private-db-details"));
  }
});
