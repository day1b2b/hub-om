import assert from "node:assert/strict";
import test from "node:test";
import { runImportStagingRequest, type ImportStagingCompositionDependencies } from "./importStagingComposition";

const key = Buffer.alloc(32, 1).toString("base64"), indexKey = Buffer.alloc(32, 2).toString("base64");
const env = { IMPORT_STAGING_BACKEND: "mongodb-shadow", MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_import_composition", MONGODB_SHADOW_NAMESPACE: "shadow_import_composition", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: indexKey };
function fixture(failure?: "connect" | "template" | "upload" | "work" | "close") {
  const seen: string[] = [], runtime = { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } };
  const dependencies: ImportStagingCompositionDependencies = {
    createClient() { seen.push("client"); return { async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private"); }, async close() { seen.push("close"); if (failure === "close") throw new Error("private"); } }; },
    async openTemplateRuntime() { seen.push("template"); if (failure === "template") throw new Error("private"); return runtime; },
    async openUploadRuntime() { seen.push("upload"); if (failure === "upload") throw new Error("private"); return runtime; }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw new Error("private"); return "ok"; };
  return { seen, dependencies, work };
}
test("import staging defaults to PostgreSQL without loading Mongo", async () => { const f = fixture(); assert.equal(await runImportStagingRequest("upload", f.work, {}, f.dependencies), "ok"); assert.deepEqual(f.seen, ["work"]); });
test("template and upload open only their selected runtime", async () => { for (const action of ["template", "upload"] as const) { const f=fixture(); assert.equal(await runImportStagingRequest(action, f.work, env, f.dependencies), "ok"); assert.deepEqual(f.seen, ["client","connect",action,"run","work","close"]); } });
test("invalid configuration fails before client and work", async () => { for (const candidate of [{ IMPORT_STAGING_BACKEND:"mongo" }, { IMPORT_STAGING_BACKEND:"mongodb-shadow" }, { ...env, MONGODB_URI:"" }, { ...env, PII_INDEX_KEY:key }]) { const f=fixture(); await assert.rejects(runImportStagingRequest("upload", f.work, candidate, f.dependencies), /^Error: IMPORT_STAGING_COMPOSITION_FAILED$/); assert.deepEqual(f.seen, []); } });
test("Mongo failures are private and clients close", async () => { for (const [action,failure] of [["template","connect"],["template","template"],["upload","upload"],["upload","work"]] as const) { const f=fixture(failure); await assert.rejects(runImportStagingRequest(action,f.work,env,f.dependencies), /^Error: IMPORT_STAGING_COMPOSITION_FAILED$/); assert.ok(f.seen.filter(x=>x==="work").length<=1); assert.equal(f.seen.at(-1),"close"); } });
test("close failure preserves completed response", async () => { const f=fixture("close"); assert.equal(await runImportStagingRequest("upload",f.work,env,f.dependencies),"ok"); });
