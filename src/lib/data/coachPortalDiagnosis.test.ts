import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseCoachPortal, repairActiveReservationIndex, type CoachPortalDiagnosisDependencies } from "./coachPortalDiagnosis";
import { MongoOperationError } from "./mongoOperationPrimitives";

const key = (fill: number) => Buffer.alloc(32, fill).toString("base64");
const shadowEnv = {
  COACH_PORTAL_BACKEND: "mongodb-shadow",
  COACH_MANAGEMENT_BACKEND: "mongodb-shadow",
  MONGODB_URI: "mongodb://user:secret@example.invalid:27017/?replicaSet=rs0",
  MONGODB_SHADOW_NAMESPACE: "shadow_test",
  MONGODB_SHADOW_DATABASE: "hub_om_shadow_test",
  MONGODB_DATABASE_ROLE: "test",
  PII_ACTIVE_KEY_ID: "k1",
  PII_ENCRYPTION_KEYS: JSON.stringify({ k1: key(1) }),
  PII_INDEX_KEY: key(2),
};

function fakes(overrides: Partial<CoachPortalDiagnosisDependencies> = {}) {
  const calls = { connect: 0, close: 0, created: 0, indexReady: false };
  const dependencies: CoachPortalDiagnosisDependencies = {
    createClient: () => ({ connect: async () => { calls.connect++; }, close: async () => { calls.close++; } }),
    models: async () => ["Coach", "CoachSchedule"],
    inspectCollection: async (_options, model) => model === "Coach" ? { exists: true, documents: 117 } : { exists: false, documents: null },
    checkCollection: async (_options, model) => { if (model !== "Coach") throw new MongoOperationError("VALIDATOR_NOT_READY"); },
    checks: async () => [
      { label: "코치 토큰 저장소 열기", run: async () => {} },
      { label: "코치 일정 저장소 열기", run: async () => { if (!calls.indexReady) throw new MongoOperationError("ACTIVE_RESERVATION_INDEX_NOT_READY"); } },
    ],
    countDuplicateActiveReservations: async () => 0,
    createActiveReservationIndex: async () => { calls.created++; calls.indexReady = true; },
    ...overrides,
  };
  return { calls, dependencies };
}

test("postgres backend stops before touching Mongo", async () => {
  const { calls, dependencies } = fakes();
  const result = await diagnoseCoachPortal({}, dependencies);
  assert.deepEqual(result.steps, [{ label: "포털 저장소 선택", ok: true, code: "POSTGRES" }]);
  assert.equal(result.selectors[0].value, "(미설정 → postgres)");
  assert.equal(calls.connect, 0);
});

test("configuration failure is reported by code without connecting", async () => {
  const { calls, dependencies } = fakes();
  const result = await diagnoseCoachPortal({ ...shadowEnv, MONGODB_SHADOW_NAMESPACE: "" }, dependencies);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].ok, false);
  assert.equal(result.steps[0].code, "SHADOW_NAMESPACE_INVALID");
  assert.equal((await diagnoseCoachPortal({ ...shadowEnv, PII_INDEX_KEY: "" }, dependencies)).steps[0].code, "PII_KEYS_INVALID");
  assert.equal((await diagnoseCoachPortal({ ...shadowEnv, MONGODB_URI: "" }, dependencies)).steps[0].code, "MONGODB_URI_MISSING_OR_INVALID");
  assert.equal(calls.connect, 0);
});

test("each collection and repository check reports its own code and the client is closed", async () => {
  const { calls, dependencies } = fakes();
  const result = await diagnoseCoachPortal(shadowEnv, dependencies);
  assert.deepEqual(result.collections, [
    { model: "Coach", exists: true, documents: 117, ok: true, code: "OK" },
    { model: "CoachSchedule", exists: false, documents: null, ok: false, code: "VALIDATOR_NOT_READY" },
  ]);
  assert.deepEqual(result.steps.map(step => [step.label, step.ok, step.code]), [
    ["Mongo 설정(namespace·암호화 키·URI)", true, "OK"],
    ["Mongo 연결", true, "OK"],
    ["코치 토큰 저장소 열기", true, "OK"],
    ["코치 일정 저장소 열기", false, "ACTIVE_RESERVATION_INDEX_NOT_READY"],
  ]);
  assert.equal(result.duplicateActiveReservations, 0);
  assert.deepEqual(calls, { connect: 1, close: 1, created: 0, indexReady: false });
});

test("a failed duplicate count is shown as unknown instead of failing the page", async () => {
  const { dependencies } = fakes({ countDuplicateActiveReservations: async () => { throw new Error("boom"); } });
  assert.equal((await diagnoseCoachPortal(shadowEnv, dependencies)).duplicateActiveReservations, null);
});

test("index repair creates only the index, then confirms the schedule repository opens", async () => {
  const { calls, dependencies } = fakes();
  assert.deepEqual(await repairActiveReservationIndex(shadowEnv, dependencies), { ok: true, code: "OK" });
  assert.deepEqual(calls, { connect: 1, close: 1, created: 1, indexReady: true });
});

test("index repair refuses duplicates, non-Mongo backends and reports failed verification", async () => {
  const duplicate = fakes({ countDuplicateActiveReservations: async () => 2 });
  assert.deepEqual(await repairActiveReservationIndex(shadowEnv, duplicate.dependencies), { ok: false, code: "DUPLICATE_ACTIVE_RESERVATIONS" });
  assert.equal(duplicate.calls.created, 0);
  assert.equal(duplicate.calls.close, 1);

  const postgres = fakes();
  assert.deepEqual(await repairActiveReservationIndex({}, postgres.dependencies), { ok: false, code: "NOT_MONGODB_SHADOW" });
  assert.equal(postgres.calls.connect, 0);

  const unverified = fakes({ createActiveReservationIndex: async () => {} });
  assert.deepEqual(await repairActiveReservationIndex(shadowEnv, unverified.dependencies), { ok: false, code: "ACTIVE_RESERVATION_INDEX_NOT_READY" });

  const rejected = fakes({ createActiveReservationIndex: async () => { throw new Error("E11000 duplicate key coachId: secret"); } });
  assert.deepEqual(await repairActiveReservationIndex(shadowEnv, rejected.dependencies), { ok: false, code: "REDACTED" });
});

test("driver messages and unexpected selector values never reach the page", async () => {
  const { calls, dependencies } = fakes({
    createClient: () => ({ connect: async () => { throw new Error("connect failed for mongodb://user:secret@host"); }, close: async () => { calls.close++; } }),
  });
  const result = await diagnoseCoachPortal({ ...shadowEnv, CHANGES_BACKEND: "mongodb://secret" }, dependencies);
  const rendered = JSON.stringify(result);
  assert.ok(!rendered.includes("secret"));
  assert.equal(result.steps.at(-1)?.code, "REDACTED");
  assert.equal(result.selectors.find(selector => selector.name === "CHANGES_BACKEND")?.value, "(형식 이상)");
  assert.equal(calls.close, 1);
});
