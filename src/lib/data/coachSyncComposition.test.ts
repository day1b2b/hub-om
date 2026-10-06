import assert from "node:assert/strict";
import test from "node:test";
import { runCoachSyncRequest, type CoachSyncCompositionDependencies } from "./coachSyncComposition";

const key = Buffer.alloc(32, 1).toString("base64"), index = Buffer.alloc(32, 2).toString("base64");
const env = { COACH_SYNC_BACKEND: "mongodb-shadow", MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_sync", MONGODB_SHADOW_NAMESPACE: "shadow_sync", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: index };
function fixture(failure?: string) {
  const seen: string[] = [];
  const dependencies: CoachSyncCompositionDependencies = {
    createClient() { seen.push("client"); return { async connect() { seen.push("connect"); if (failure === "connect") throw 0; }, async close() { seen.push("close"); if (failure === "close") throw 0; } }; },
    notionSource: { async readPages() { return []; } },
    sheetSource: { async readContract() { return { values: [], struckCells: new Set<string>() }; }, async readSamsung() { return { rows: [], contractRows: [] }; } },
    async openRuntime(input) { seen.push("open"); assert.equal(input.coachNotionSource, dependencies.notionSource); assert.equal(input.coachSheetSource, dependencies.sheetSource); if (failure === "open") throw 0; return { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } }; }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw 0; return "ok"; };
  return { seen, dependencies, work };
}
test("coach sync defaults to PostgreSQL", async () => { const f = fixture(); assert.equal(await runCoachSyncRequest(f.work, {}, f.dependencies), "ok"); assert.deepEqual(f.seen, ["work"]); });
test("exact Mongo selector owns one client and both sources", async () => { const f = fixture(); assert.equal(await runCoachSyncRequest(f.work, env, f.dependencies), "ok"); assert.deepEqual(f.seen, ["client", "connect", "open", "run", "work", "close"]); });
test("invalid selector and config fail before effects", async () => { for (const e of [{ COACH_SYNC_BACKEND: "mongo" }, { COACH_SYNC_BACKEND: "mongodb-shadow" }, { ...env, PII_INDEX_KEY: key }]) { const f = fixture(); await assert.rejects(runCoachSyncRequest(f.work, e, f.dependencies), /COACH_SYNC_COMPOSITION_FAILED/); assert.deepEqual(f.seen, []); } });
test("failures close and redact", async () => { for (const value of ["connect", "open", "work"]) { const f = fixture(value); await assert.rejects(runCoachSyncRequest(f.work, env, f.dependencies), /COACH_SYNC_COMPOSITION_FAILED/); assert.equal(f.seen.at(-1), "close"); } });
test("cleanup failure preserves result", async () => { const f = fixture("close"); assert.equal(await runCoachSyncRequest(f.work, env, f.dependencies), "ok"); });
