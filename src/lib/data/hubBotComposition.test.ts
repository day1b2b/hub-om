import assert from "node:assert/strict";
import test from "node:test";
import { runHubBotRequest, type HubBotCompositionDependencies } from "./hubBotComposition";

const key = Buffer.alloc(32, 1).toString("base64"), index = Buffer.alloc(32, 2).toString("base64");
const env = { HUBBOT_BACKEND: "mongodb-shadow", MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_hubbot", MONGODB_SHADOW_NAMESPACE: "shadow_hubbot", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: index };
function fixture(failure?: string) {
  const seen: string[] = [];
  const dependencies: HubBotCompositionDependencies = {
    responder() { seen.push("responder"); if (failure === "responder") throw 0; return { async reply() { return "ok"; } }; },
    createClient() { seen.push("client"); return { async connect() { seen.push("connect"); if (failure === "connect") throw 0; }, async close() { seen.push("close"); if (failure === "close") throw 0; } }; },
    async openRuntime() { seen.push("open"); if (failure === "open") throw 0; return { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } }; }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw 0; return "ok"; };
  return { seen, dependencies, work };
}
test("Hubbot defaults to PostgreSQL", async () => { const f=fixture(); assert.equal(await runHubBotRequest(f.work,{},f.dependencies),"ok"); assert.deepEqual(f.seen,["work"]); });
test("exact Mongo selector owns responder, client and runtime", async () => { const f=fixture(); assert.equal(await runHubBotRequest(f.work,env,f.dependencies),"ok"); assert.deepEqual(f.seen,["responder","client","connect","open","run","work","close"]); });
test("invalid selector and config fail before dependencies", async () => { for (const e of [{HUBBOT_BACKEND:"mongo"},{HUBBOT_BACKEND:"mongodb-shadow"},{...env,PII_INDEX_KEY:key}]) { const f=fixture(); await assert.rejects(runHubBotRequest(f.work,e,f.dependencies),/^Error: HUBBOT_COMPOSITION_FAILED$/); assert.deepEqual(f.seen,[]); } });
test("failures redact and close owned clients", async () => { for (const x of ["responder","connect","open","work"]) { const f=fixture(x); await assert.rejects(runHubBotRequest(f.work,env,f.dependencies),/^Error: HUBBOT_COMPOSITION_FAILED$/); if (x!=="responder") assert.equal(f.seen.at(-1),"close"); } });
test("cleanup failure preserves result", async () => { const f=fixture("close"); assert.equal(await runHubBotRequest(f.work,env,f.dependencies),"ok"); });
test("Next redirect control flow is preserved", async () => { const f=fixture(); const redirect=Object.assign(new Error("redirect"),{digest:"NEXT_REDIRECT;replace;/sign-in;307;"}); await assert.rejects(runHubBotRequest(async()=>{throw redirect;},env,f.dependencies),error=>error===redirect); });
