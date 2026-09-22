import assert from "node:assert/strict";
import test from "node:test";
import { configuredMongoUri, diagnoseMongoConnection, shadowDatabaseName } from "./connection";

test("URI alone cannot select a writable shadow database or alter PostgreSQL", () => {
  const env = { MONGODB_URI: "mongodb://fixture:secret@example.invalid/production", DATABASE_URL: "postgresql://unchanged" };
  assert.equal(configuredMongoUri(env), env.MONGODB_URI);
  assert.throws(() => shadowDatabaseName(env), /EXPLICIT_SHADOW/);
  for (const name of ["production", "admin", "config", "local", "hub_om_shadow_", "hub_om_shadow_a.$"]) assert.throws(() => shadowDatabaseName({ ...env, MONGODB_SHADOW_DATABASE: name }));
  assert.equal(shadowDatabaseName({ ...env, MONGODB_SHADOW_DATABASE: "hub_om_shadow_rehearsal" }), "hub_om_shadow_rehearsal");
  assert.equal(env.DATABASE_URL, "postgresql://unchanged");
});
test("diagnostic only issues ping/hello, sanitizes output and closes client", async () => {
  const commands: unknown[] = []; let closed = false;
  const result = await diagnoseMongoConnection({ MONGODB_URI: "mongodb://fixture.invalid" }, () => ({
    async connect() {}, async close() { closed = true; },
    db(name) { assert.equal(name, "admin"); return { async command(command) { commands.push(command); return { setName: "sensitive-topology", hosts: ["internal-host"], logicalSessionTimeoutMinutes: 30, maxWireVersion: 25 }; } }; },
  }));
  assert.deepEqual(commands, [{ ping: 1 }, { hello: 1 }]);
  assert.equal(result.transactionsAdvertised, true); assert.equal(result.readyForCutover, false); assert.equal(closed, true);
  assert.ok(!JSON.stringify(result).includes("internal-host")); assert.ok(!JSON.stringify(result).includes("sensitive"));
});
test("standalone is connected but cannot pass transaction readiness", async () => {
  const result = await diagnoseMongoConnection({ MONGODB_URI: "mongodb://fixture.invalid" }, () => ({ async connect() {}, async close() {}, db() { return { async command() { return { maxWireVersion: 25, logicalSessionTimeoutMinutes: 30 }; } }; } }));
  assert.equal(result.topology, "standalone"); assert.equal(result.transactionsAdvertised, false);
});
test("authentication/network/constructor errors never expose credentials", async () => {
  let closed = false;
  await assert.rejects(diagnoseMongoConnection({ MONGODB_URI: "mongodb://fixture:secret@fixture.invalid" }, () => ({
    async connect() { throw new Error("mongodb://fixture:secret@fixture.invalid"); }, async close() { closed = true; }, db() { throw new Error("unused"); },
  })), error => error instanceof Error && error.message === "MONGODB_CONNECTION_CHECK_FAILED");
  assert.equal(closed, true);
  await assert.rejects(diagnoseMongoConnection({ MONGODB_URI: "mongodb://fixture.invalid" }, () => { throw new Error("secret"); }), /MONGODB_CONNECTION_CHECK_FAILED/);
});
