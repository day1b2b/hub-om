import assert from "node:assert/strict";
import test from "node:test";
import { runOmRequestPagesRequest, type OmRequestPagesCompositionDependencies } from "./omRequestPagesComposition";

const key = Buffer.alloc(32, 1).toString("base64"), index = Buffer.alloc(32, 2).toString("base64");
const environment = { OM_REQUEST_PAGES_BACKEND: "mongodb-shadow", MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_request_pages", MONGODB_SHADOW_NAMESPACE: "shadow_request_pages", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: index };
function fixture(failure?: string) {
  const seen: string[] = [];
  const dependencies: OmRequestPagesCompositionDependencies = {
    createClient() { seen.push("client"); return { async connect() { seen.push("connect"); if (failure === "connect") throw 0; }, async close() { seen.push("close"); if (failure === "close") throw 0; } }; },
    getCustomTools() { seen.push("tools"); return { list: () => [], add: () => {} }; },
    async openRuntime() { seen.push("open"); if (failure === "open") throw 0; return { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } }; }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw 0; return "ok"; };
  return { seen, dependencies, work };
}
test("OM request pages default to PostgreSQL", async () => { const f = fixture(); assert.equal(await runOmRequestPagesRequest(f.work, {}, f.dependencies), "ok"); assert.deepEqual(f.seen, ["work"]); });
test("exact Mongo selector owns one client and borrowed tools", async () => { const f = fixture(); assert.equal(await runOmRequestPagesRequest(f.work, environment, f.dependencies), "ok"); assert.deepEqual(f.seen, ["client", "connect", "tools", "open", "run", "work", "close"]); });
test("invalid selector and config fail before client", async () => { for (const value of [{ OM_REQUEST_PAGES_BACKEND: "mongo" }, { OM_REQUEST_PAGES_BACKEND: "mongodb-shadow" }, { ...environment, PII_INDEX_KEY: key }]) { const f = fixture(); await assert.rejects(runOmRequestPagesRequest(f.work, value, f.dependencies), /OM_REQUEST_PAGES_COMPOSITION_FAILED/); assert.deepEqual(f.seen, []); } });
test("failures close and redact", async () => { for (const value of ["connect", "open", "work"]) { const f = fixture(value); await assert.rejects(runOmRequestPagesRequest(f.work, environment, f.dependencies), /OM_REQUEST_PAGES_COMPOSITION_FAILED/); assert.equal(f.seen.at(-1), "close"); } });
test("cleanup failure preserves result", async () => { const f = fixture("close"); assert.equal(await runOmRequestPagesRequest(f.work, environment, f.dependencies), "ok"); });
test("Next control flow is preserved", async () => { for (const digest of ["NEXT_REDIRECT;replace;/sign-in;307;", "NEXT_HTTP_ERROR_FALLBACK;404"]) { const control = Object.assign(new Error("control"), { digest }), f = fixture(); await assert.rejects(runOmRequestPagesRequest(async () => { throw control; }, environment, f.dependencies), error => error === control); } });
