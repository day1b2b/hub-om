import assert from "node:assert/strict";
import test from "node:test";
import type { NotionImportSource } from "./notionImportSource";
import { runNotionImportRequest, type NotionImportCompositionDependencies } from "./notionImportComposition";

const key = Buffer.alloc(32, 1).toString("base64");
const indexKey = Buffer.alloc(32, 2).toString("base64");
const env = { NOTION_IMPORT_BACKEND: "mongodb-shadow", MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_notion_composition", MONGODB_SHADOW_NAMESPACE: "shadow_notion_composition", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: indexKey };
const source = { async readDatabase() { throw new Error("unused"); } } as NotionImportSource;

function fixture(failure?: "connect" | "open" | "work" | "close") {
  const seen: string[] = [];
  const dependencies: NotionImportCompositionDependencies = {
    source,
    createClient() { seen.push("client"); return {
      async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private connect"); },
      async close() { seen.push("close"); if (failure === "close") throw new Error("private close"); }
    }; },
    async openRuntime(input) { seen.push("open"); assert.equal(input.notionImportSource, source); if (failure === "open") throw new Error("private open"); return {
      async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); }
    }; }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw new Error("private work"); return "ok"; };
  return { seen, dependencies, work };
}

test("Notion import defaults to PostgreSQL without loading Mongo", async () => {
  const item = fixture(); assert.equal(await runNotionImportRequest(item.work, {}, item.dependencies), "ok"); assert.deepEqual(item.seen, ["work"]);
});

test("exact Mongo selector opens one runtime and closes its client", async () => {
  const item = fixture(); assert.equal(await runNotionImportRequest(item.work, env, item.dependencies), "ok");
  assert.deepEqual(item.seen, ["client", "connect", "open", "run", "work", "close"]);
});

test("invalid selector and incomplete configuration fail before client or work", async () => {
  for (const candidate of [{ NOTION_IMPORT_BACKEND: "mongo" }, { NOTION_IMPORT_BACKEND: "mongodb-shadow" }, { ...env, MONGODB_URI: "" }, { ...env, PII_INDEX_KEY: key }]) {
    const item = fixture(); await assert.rejects(runNotionImportRequest(item.work, candidate, item.dependencies), /^Error: NOTION_IMPORT_COMPOSITION_FAILED$/); assert.deepEqual(item.seen, []);
  }
});

test("Mongo failures are private, work runs at most once, and owned clients close", async () => {
  for (const failure of ["connect", "open", "work"] as const) {
    const item = fixture(failure); await assert.rejects(runNotionImportRequest(item.work, env, item.dependencies), /^Error: NOTION_IMPORT_COMPOSITION_FAILED$/);
    assert.ok(item.seen.filter(value => value === "work").length <= 1); assert.equal(item.seen.at(-1), "close");
  }
});

test("close failure does not change a completed and audited result", async () => {
  const item = fixture("close"); assert.equal(await runNotionImportRequest(item.work, env, item.dependencies), "ok"); assert.equal(item.seen.at(-1), "close");
});
