import assert from "node:assert/strict";
import test from "node:test";
import { runHealthRequest, type HealthCompositionDependencies } from "./healthComposition";

const key = Buffer.alloc(32, 1).toString("base64");
const indexKey = Buffer.alloc(32, 2).toString("base64");
const environment = {
  HEALTH_BACKEND: "mongodb-shadow",
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  MONGODB_SHADOW_DATABASE: "hub_om_shadow_health",
  MONGODB_SHADOW_NAMESPACE: "shadow_health",
  PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }),
  PII_ACTIVE_KEY_ID: "fixture",
  PII_INDEX_KEY: indexKey
};

function fixture(failure?: "connect" | "open" | "work" | "close") {
  const seen: string[] = [];
  const dependencies: HealthCompositionDependencies = {
    createClient() {
      seen.push("client");
      return {
        async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private"); },
        async close() { seen.push("close"); if (failure === "close") throw new Error("private"); }
      };
    },
    openRuntime() {
      seen.push("open");
      if (failure === "open") throw new Error("private");
      return { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } };
    }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw new Error("private"); return "ok"; };
  return { dependencies, seen, work };
}

test("health defaults to PostgreSQL", async () => {
  const value = fixture();
  assert.equal(await runHealthRequest(value.work, {}, value.dependencies), "ok");
  assert.deepEqual(value.seen, ["work"]);
});

test("exact Mongo selector owns one client", async () => {
  const value = fixture();
  assert.equal(await runHealthRequest(value.work, environment, value.dependencies), "ok");
  assert.deepEqual(value.seen, ["client", "connect", "open", "run", "work", "close"]);
});

test("invalid selector and configuration fail before client creation", async () => {
  for (const invalid of [{ HEALTH_BACKEND: "mongo" }, { HEALTH_BACKEND: "mongodb-shadow" }, { ...environment, PII_INDEX_KEY: key }]) {
    const value = fixture();
    await assert.rejects(runHealthRequest(value.work, invalid, value.dependencies), /^Error: HEALTH_COMPOSITION_FAILED$/);
    assert.deepEqual(value.seen, []);
  }
});

test("failures close the client and redact details", async () => {
  for (const failure of ["connect", "open", "work"] as const) {
    const value = fixture(failure);
    await assert.rejects(runHealthRequest(value.work, environment, value.dependencies), /^Error: HEALTH_COMPOSITION_FAILED$/);
    assert.equal(value.seen.at(-1), "close");
  }
});

test("cleanup failure preserves successful health result", async () => {
  const value = fixture("close");
  assert.equal(await runHealthRequest(value.work, environment, value.dependencies), "ok");
});
