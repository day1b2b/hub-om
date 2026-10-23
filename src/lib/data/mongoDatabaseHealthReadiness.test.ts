import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mock, test } from "node:test";
import type { MongoClient } from "mongodb";
import { MongoDatabaseHealthRepository } from "./mongoDatabaseHealthRepository";
import { MongoOperationError } from "./mongoOperationPrimitives";

const privacy = {
  PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
  PII_ACTIVE_KEY_ID: "fixture",
  PII_INDEX_KEY: randomBytes(32).toString("base64"),
};

function pingClient(calls: string[]) {
  return { db: () => ({ async command() { calls.push("ping"); return { ok: 1 }; } }) } as unknown as MongoClient;
}

async function withPrivacy(work: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(privacy).map(key => [key, process.env[key]]));
  Object.assign(process.env, privacy);
  try { await work(); }
  finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("health without a readiness check stays ping-only", () => withPrivacy(async () => {
  const calls: string[] = [];
  await new MongoDatabaseHealthRepository(pingClient(calls), "hub_om_shadow_health").check();
  assert.deepEqual(calls, ["ping"]);
}));

test("health runs readiness after the ping and passes when it holds", () => withPrivacy(async () => {
  const calls: string[] = [];
  await new MongoDatabaseHealthRepository(pingClient(calls), "hub_om_shadow_health", async () => { calls.push("readiness"); }).check();
  assert.deepEqual(calls, ["ping", "readiness"]);
}));

test("a validator mismatch fails health with the fixed error and logs only the failure code", () => withPrivacy(async () => {
  const logged = mock.method(console, "error", () => {});
  try {
    const repository = new MongoDatabaseHealthRepository(pingClient([]), "hub_om_shadow_health", async () => { throw new MongoOperationError("VALIDATOR_NOT_READY"); });
    await assert.rejects(repository.check(), { message: "DATABASE_HEALTH_CHECK_FAILED" });
    assert.deepEqual(logged.mock.calls.map(call => call.arguments), [["DATABASE_HEALTH_READINESS_FAILED", "VALIDATOR_NOT_READY"]]);
  } finally { logged.mock.restore(); }
}));
