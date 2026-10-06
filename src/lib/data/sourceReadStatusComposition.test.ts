import assert from "node:assert/strict";
import test from "node:test";
import type { OperationSourceReader } from "../sourceReads/sourceReadTypes";
import { runSourceReadStatusRequest, type SourceReadStatusCompositionDependencies } from "./sourceReadStatusComposition";

const reader = {} as OperationSourceReader;
const key = Buffer.alloc(32, 1).toString("base64"), indexKey = Buffer.alloc(32, 2).toString("base64");
const mongoEnv = { SOURCE_READ_STATUS_BACKEND: "mongodb-shadow", MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_source_status", MONGODB_SHADOW_NAMESPACE: "shadow_source_status", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: indexKey };
function fixture(failure?: "connect" | "source" | "open" | "work" | "close") {
  const seen: string[] = [];
  const dependencies: SourceReadStatusCompositionDependencies = {
    async getSourceReader() { seen.push("source"); if (failure === "source") throw new Error("private source"); return reader; },
    createClient() { seen.push("client"); return {
      async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private connect"); },
      async close() { seen.push("close"); if (failure === "close") throw new Error("private close"); }
    }; },
    async openRuntime(input) { seen.push("open"); assert.equal(input.operationSourceReader, reader); if (failure === "open") throw new Error("private open"); return {
      async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); }
    }; }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw new Error("private work"); return "ok"; };
  return { seen, dependencies, work };
}

test("selector defaults to PostgreSQL without loading Mongo or source", async () => {
  const item = fixture(); assert.equal(await runSourceReadStatusRequest(item.work, {}, item.dependencies), "ok"); assert.deepEqual(item.seen, ["work"]);
});
test("exact Mongo selector opens one prepared runtime and closes its client", async () => {
  const item = fixture(); assert.equal(await runSourceReadStatusRequest(item.work, mongoEnv, item.dependencies), "ok"); assert.deepEqual(item.seen, ["source", "client", "connect", "open", "run", "work", "close"]);
});
test("invalid selector and incomplete coordinates fail before work without fallback", async () => {
  for (const env of [{ SOURCE_READ_STATUS_BACKEND: "mongo" }, { SOURCE_READ_STATUS_BACKEND: "mongodb-shadow" }, { SOURCE_READ_STATUS_BACKEND: "mongodb-shadow", MONGODB_SHADOW_NAMESPACE: "bad" },
    { ...mongoEnv, MONGODB_URI: "" }, { ...mongoEnv, MONGODB_SHADOW_DATABASE: "production" }]) {
    const item = fixture(); await assert.rejects(runSourceReadStatusRequest(item.work, env, item.dependencies), /^Error: SOURCE_READ_STATUS_COMPOSITION_FAILED$/); assert.deepEqual(item.seen, []);
  }
});
test("Mongo selector rejects missing, malformed, unknown and shared privacy keys before source or connection", async () => {
  const nonCanonicalAlias = `${key.slice(0, -2)}F=`;
  assert.deepEqual(Buffer.from(nonCanonicalAlias, "base64"), Buffer.from(key, "base64"));
  const invalid = [
    { ...mongoEnv, PII_ENCRYPTION_KEYS: "" },
    { ...mongoEnv, PII_ENCRYPTION_KEYS: "{" },
    { ...mongoEnv, PII_ACTIVE_KEY_ID: "missing" },
    { ...mongoEnv, PII_INDEX_KEY: "invalid" },
    { ...mongoEnv, PII_INDEX_KEY: key },
    { ...mongoEnv, PII_INDEX_KEY: nonCanonicalAlias }
  ];
  for (const env of invalid) {
    const item = fixture(); await assert.rejects(runSourceReadStatusRequest(item.work, env, item.dependencies), /^Error: SOURCE_READ_STATUS_COMPOSITION_FAILED$/); assert.deepEqual(item.seen, []);
  }
});
test("Mongo failures are sanitized, never rerun work, and close owned clients", async () => {
  for (const failure of ["source", "connect", "open", "work"] as const) {
    const item = fixture(failure); await assert.rejects(runSourceReadStatusRequest(item.work, mongoEnv, item.dependencies), /^Error: SOURCE_READ_STATUS_COMPOSITION_FAILED$/);
    assert.ok(item.seen.filter(value => value === "work").length <= 1); if (item.seen.includes("client")) assert.equal(item.seen.at(-1), "close");
  }
});
test("client close failure does not change an already completed and audited result", async () => {
  const item = fixture("close"); assert.equal(await runSourceReadStatusRequest(item.work, mongoEnv, item.dependencies), "ok");
  assert.deepEqual(item.seen, ["source", "client", "connect", "open", "run", "work", "close"]);
});
