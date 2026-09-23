import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCreationReplay, creationOperationId, operationCreationIdentity, OperationCreationConflict } from "./operationCreationIdentity";

const key = "fixture-creation-key:0";
test("같은 키와 같은 본문은 JSON 키 순서와 무관하게 같은 식별자다", () => {
  assert.deepEqual(operationCreationIdentity(key, "A@example.test", "/api/operations", { a: 1, b: { c: 2 } }),
    operationCreationIdentity(key, "a@example.test", "/api/operations", { b: { c: 2 }, a: 1 }));
});
test("같은 키로 본문을 바꾸거나 삭제된 회차를 다시 만들면 충돌이다", () => {
  const first = operationCreationIdentity(key, "a@example.test", "/api/operations", { roundNo: "1" })!;
  const changed = operationCreationIdentity(key, "a@example.test", "/api/operations", { roundNo: "2" })!;
  assert.equal(first.scope, changed.scope);
  assert.throws(() => assertCreationReplay(changed, { operationId: creationOperationId(first) }), OperationCreationConflict);
  assert.throws(() => assertCreationReplay(first, { operationId: creationOperationId(first), deletedAt: new Date() }), OperationCreationConflict);
});
test("다른 사용자와 API 경로는 같은 키로 기존 자료를 조회할 수 없다", () => {
  const ids = [
    operationCreationIdentity(key, "a@example.test", "/api/operations", {}),
    operationCreationIdentity(key, "b@example.test", "/api/operations", {}),
    operationCreationIdentity(key, "a@example.test", "/api/operations/base/rounds", {})
  ].map((identity) => creationOperationId(identity!));
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every((id) => !id.includes("example.test") && !id.includes(key)));
});
test("선택 헤더가 없으면 기존 생성이며 부적절한 키나 익명 키는 거부한다", () => {
  assert.equal(operationCreationIdentity(null, null, "/api/operations", {}), undefined);
  for (const invalid of ["", "short", "x".repeat(129), "../fixture-creation-key"]) {
    assert.throws(() => operationCreationIdentity(invalid, "a@example.test", "/api/operations", {}));
  }
  assert.throws(() => operationCreationIdentity(key, undefined, "/api/operations", {}));
});
