import assert from "node:assert/strict";
import test from "node:test";
import { runAdminBackupRequest, type AdminBackupCompositionDependencies } from "./adminBackupComposition";

const key = Buffer.alloc(32, 1).toString("base64"), indexKey = Buffer.alloc(32, 2).toString("base64");
const environment = {
  ADMIN_BACKUP_BACKEND: "mongodb-shadow", MONGODB_URI: "mongodb://127.0.0.1:27017",
  MONGODB_SHADOW_DATABASE: "hub_om_shadow_backup", MONGODB_SHADOW_NAMESPACE: "shadow_backup",
  PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: indexKey
};
function fixture(failure?: "connect" | "open" | "work" | "close") {
  const seen: string[] = [];
  const dependencies: AdminBackupCompositionDependencies = {
    createClient() { seen.push("client"); return {
      async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private"); },
      async close() { seen.push("close"); if (failure === "close") throw new Error("private"); }
    }; },
    async openRuntime() { seen.push("open"); if (failure === "open") throw new Error("private"); return {
      async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); }
    }; }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw new Error("private"); return "ok"; };
  return { dependencies, seen, work };
}
test("admin backup defaults to PostgreSQL", async () => { const f = fixture(); assert.equal(await runAdminBackupRequest(f.work, {}, f.dependencies), "ok"); assert.deepEqual(f.seen, ["work"]); });
test("exact Mongo selector owns one client", async () => { const f = fixture(); assert.equal(await runAdminBackupRequest(f.work, environment, f.dependencies), "ok"); assert.deepEqual(f.seen, ["client", "connect", "open", "run", "work", "close"]); });
test("invalid selector and configuration fail before client", async () => { for (const invalid of [{ ADMIN_BACKUP_BACKEND: "mongo" }, { ADMIN_BACKUP_BACKEND: "mongodb-shadow" }, { ...environment, PII_INDEX_KEY: key }]) { const f = fixture(); await assert.rejects(runAdminBackupRequest(f.work, invalid, f.dependencies), /^Error: ADMIN_BACKUP_COMPOSITION_FAILED$/); assert.deepEqual(f.seen, []); } });
test("failures close and redact", async () => { for (const failure of ["connect", "open", "work"] as const) { const f = fixture(failure); await assert.rejects(runAdminBackupRequest(f.work, environment, f.dependencies), /^Error: ADMIN_BACKUP_COMPOSITION_FAILED$/); assert.equal(f.seen.at(-1), "close"); } });
test("cleanup failure preserves result", async () => { const f = fixture("close"); assert.equal(await runAdminBackupRequest(f.work, environment, f.dependencies), "ok"); });
