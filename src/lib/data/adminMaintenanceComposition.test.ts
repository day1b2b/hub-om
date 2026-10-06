import assert from "node:assert/strict";
import test from "node:test";
import { runAdminMaintenanceRequest, type AdminMaintenanceCompositionDependencies } from "./adminMaintenanceComposition";

const key = Buffer.alloc(32, 1).toString("base64"), index = Buffer.alloc(32, 2).toString("base64");
const environment = { ADMIN_MAINTENANCE_BACKEND: "mongodb-shadow", MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_SHADOW_DATABASE: "hub_om_shadow_maintenance", MONGODB_SHADOW_NAMESPACE: "shadow_maintenance", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: index };
function fixture(failure?: string) {
  const seen: string[] = [];
  const dependencies: AdminMaintenanceCompositionDependencies = {
    createClient() { seen.push("client"); return { async connect() { seen.push("connect"); if (failure === "connect") throw 0; }, async close() { seen.push("close"); if (failure === "close") throw 0; } }; },
    async openRuntime() { seen.push("open"); if (failure === "open") throw 0; return { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } }; },
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw 0; return "ok"; };
  return { seen, dependencies, work };
}
test("admin maintenance defaults to PostgreSQL", async () => { const value = fixture(); assert.equal(await runAdminMaintenanceRequest(value.work, {}, value.dependencies), "ok"); assert.deepEqual(value.seen, ["work"]); });
test("exact Mongo selector owns one client", async () => { const value = fixture(); assert.equal(await runAdminMaintenanceRequest(value.work, environment, value.dependencies), "ok"); assert.deepEqual(value.seen, ["client", "connect", "open", "run", "work", "close"]); });
test("invalid selector and config fail before client", async () => { for (const candidate of [{ ADMIN_MAINTENANCE_BACKEND: "mongo" }, { ADMIN_MAINTENANCE_BACKEND: "mongodb-shadow" }, { ...environment, PII_INDEX_KEY: key }]) { const value = fixture(); await assert.rejects(runAdminMaintenanceRequest(value.work, candidate, value.dependencies), /ADMIN_MAINTENANCE_COMPOSITION_FAILED/); assert.deepEqual(value.seen, []); } });
test("failures close and redact", async () => { for (const failure of ["connect", "open", "work"]) { const value = fixture(failure); await assert.rejects(runAdminMaintenanceRequest(value.work, environment, value.dependencies), /ADMIN_MAINTENANCE_COMPOSITION_FAILED/); assert.equal(value.seen.at(-1), "close"); } });
test("cleanup failure preserves result", async () => { const value = fixture("close"); assert.equal(await runAdminMaintenanceRequest(value.work, environment, value.dependencies), "ok"); });
test("Next control flow is preserved", async () => { for (const digest of ["NEXT_REDIRECT;replace;/dashboard;307;", "NEXT_HTTP_ERROR_FALLBACK;404"]) { const control = Object.assign(new Error("control"), { digest }); const value = fixture(); await assert.rejects(runAdminMaintenanceRequest(async () => { throw control; }, environment, value.dependencies), error => error === control); } });
