import assert from "node:assert/strict";
import test from "node:test";
import { runCoachPublicRequest, type CoachPublicCompositionDependencies } from "./coachPublicComposition";

const key = Buffer.alloc(32, 1).toString("base64");
const index = Buffer.alloc(32, 2).toString("base64");
const environment = { COACH_PUBLIC_BACKEND: "mongodb-shadow", MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_coach_public", MONGODB_SHADOW_NAMESPACE: "shadow_coach_public", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: index };
function fixture(failure?: string) {
  const seen: string[] = [];
  const dependencies: CoachPublicCompositionDependencies = {
    createClient() { seen.push("client"); return { async connect() { seen.push("connect"); if (failure === "connect") throw 0; }, async close() { seen.push("close"); if (failure === "close") throw 0; } }; },
    async openRuntime() { seen.push("open"); if (failure === "open") throw 0; return { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } }; }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw 0; return "ok"; };
  return { seen, dependencies, work };
}
test("coach public defaults to PostgreSQL", async () => { const f = fixture(); assert.equal(await runCoachPublicRequest(f.work, {}, f.dependencies), "ok"); assert.deepEqual(f.seen, ["work"]); });
test("exact Mongo selector owns one client and runtime", async () => { const f = fixture(); assert.equal(await runCoachPublicRequest(f.work, environment, f.dependencies), "ok"); assert.deepEqual(f.seen, ["client", "connect", "open", "run", "work", "close"]); });
test("invalid selector and config fail before client", async () => { for (const value of [{ COACH_PUBLIC_BACKEND: "mongo" }, { COACH_PUBLIC_BACKEND: "mongodb-shadow" }, { ...environment, PII_INDEX_KEY: key }]) { const f = fixture(); await assert.rejects(runCoachPublicRequest(f.work, value, f.dependencies), /COACH_PUBLIC_COMPOSITION_FAILED/); assert.deepEqual(f.seen, []); } });
test("failures close and redact", async () => { for (const value of ["connect", "open", "work"]) { const f = fixture(value); await assert.rejects(runCoachPublicRequest(f.work, environment, f.dependencies), /COACH_PUBLIC_COMPOSITION_FAILED/); assert.equal(f.seen.at(-1), "close"); } });
test("cleanup failure preserves result", async () => { const f = fixture("close"); assert.equal(await runCoachPublicRequest(f.work, environment, f.dependencies), "ok"); });
test("Next control flow is preserved", async () => { for (const digest of ["NEXT_REDIRECT;replace;/sign-in;307;", "NEXT_HTTP_ERROR_FALLBACK;404"]) { const control = Object.assign(new Error("control"), { digest }), f = fixture(); await assert.rejects(runCoachPublicRequest(async () => { throw control; }, environment, f.dependencies), error => error === control); } });
