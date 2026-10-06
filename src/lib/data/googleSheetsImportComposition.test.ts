import assert from "node:assert/strict";
import test from "node:test";
import type { GoogleSheetsImportSource } from "./googleSheetsImportSource";
import { runGoogleSheetsImportRequest, type GoogleSheetsImportCompositionDependencies } from "./googleSheetsImportComposition";

const key = Buffer.alloc(32, 1).toString("base64"), indexKey = Buffer.alloc(32, 2).toString("base64");
const env = { GOOGLE_SHEETS_IMPORT_BACKEND: "mongodb-shadow", MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_sheets_composition", MONGODB_SHADOW_NAMESPACE: "shadow_sheets_composition", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: indexKey };
const source = {} as GoogleSheetsImportSource;
function fixture(failure?: "connect" | "tabs" | "import" | "work" | "close") {
  const seen: string[] = [];
  const runtime = { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } };
  const dependencies: GoogleSheetsImportCompositionDependencies = {
    source,
    createClient() { seen.push("client"); return {
      async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private connect"); },
      async close() { seen.push("close"); if (failure === "close") throw new Error("private close"); }
    }; },
    async openTabsRuntime(input) { seen.push("tabs"); assert.equal(input.googleSheetsImportSource, source); if (failure === "tabs") throw new Error("private tabs"); return runtime; },
    async openImportRuntime(input) { seen.push("import"); assert.equal(input.googleSheetsImportSource, source); if (failure === "import") throw new Error("private import"); return runtime; }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw new Error("private work"); return "ok"; };
  return { seen, dependencies, work };
}

test("Sheets defaults to PostgreSQL without loading Mongo", async () => {
  const item = fixture(); assert.equal(await runGoogleSheetsImportRequest("tabs", item.work, {}, item.dependencies), "ok"); assert.deepEqual(item.seen, ["work"]);
});

test("tabs and import select only their exact prepared runtime", async () => {
  for (const action of ["tabs", "import"] as const) {
    const item = fixture(); assert.equal(await runGoogleSheetsImportRequest(action, item.work, env, item.dependencies), "ok");
    assert.deepEqual(item.seen, ["client", "connect", action, "run", "work", "close"]);
  }
});

test("invalid selector or shadow configuration fails before client and work", async () => {
  for (const candidate of [{ GOOGLE_SHEETS_IMPORT_BACKEND: "mongo" }, { GOOGLE_SHEETS_IMPORT_BACKEND: "mongodb-shadow" }, { ...env, MONGODB_URI: "" }, { ...env, PII_INDEX_KEY: key }]) {
    const item = fixture(); await assert.rejects(runGoogleSheetsImportRequest("import", item.work, candidate, item.dependencies), /^Error: GOOGLE_SHEETS_IMPORT_COMPOSITION_FAILED$/); assert.deepEqual(item.seen, []);
  }
});

test("Mongo failures are private, work runs at most once, and owned clients close", async () => {
  for (const [action, failure] of [["tabs", "connect"], ["tabs", "tabs"], ["import", "import"], ["import", "work"]] as const) {
    const item = fixture(failure); await assert.rejects(runGoogleSheetsImportRequest(action, item.work, env, item.dependencies), /^Error: GOOGLE_SHEETS_IMPORT_COMPOSITION_FAILED$/);
    assert.ok(item.seen.filter(value => value === "work").length <= 1); assert.equal(item.seen.at(-1), "close");
  }
});

test("close failure does not change a completed and audited result", async () => {
  const item = fixture("close"); assert.equal(await runGoogleSheetsImportRequest("import", item.work, env, item.dependencies), "ok"); assert.equal(item.seen.at(-1), "close");
});
