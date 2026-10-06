import assert from "node:assert/strict";
import test from "node:test";
import { shadowJobCommand } from "./shadowJobCommand";
import { newShadowExportDirectory } from "./postgresShadowExport";

const configured = {
  DATABASE_URL: "postgres://synthetic:synthetic@localhost/example", MONGODB_URI: "mongodb://localhost/example",
  MONGODB_SHADOW_DATABASE: "hub-om-shadow-validation", MONGODB_PRODUCTION_DATABASE: "hub-om", MONGODB_ALLOW_SHADOW_WRITES: "true",
  PII_ACTIVE_KEY_ID: "synthetic", PII_ENCRYPTION_KEYS: "synthetic", PII_INDEX_KEY: "synthetic",
  AUTH_SECRET: "unrelated", NODE_OPTIONS: "--require malicious", PGOPTIONS: "-c default_transaction_read_only=off"
};
test("shadow job exports read-only with only source credentials", () => {
  const command = shadowJobCommand(["export", "plaintext", "--allow-read-only-source-export"], configured);
  assert.ok(command.args.includes("scripts/export-mongodb-shadow.ts"));
  assert.equal(command.env.DATABASE_URL, configured.DATABASE_URL);
  assert.match(command.env.PGOPTIONS, /default_transaction_read_only=on/);
  for (const key of ["MONGODB_URI", "MONGODB_ALLOW_SHADOW_WRITES", "AUTH_SECRET", "NODE_OPTIONS"]) assert.equal(command.env[key], undefined);
  assert.equal(command.env.PII_ALLOW_PLAINTEXT_READS, "false");
});
test("shadow job imports with no PostgreSQL connection and explicit target", () => {
  const directory = newShadowExportDirectory("/spool");
  const command = shadowJobCommand(["import", directory, "rehearsal_01", "--apply-shadow-only"], configured);
  assert.ok(command.args.includes(directory));
  assert.ok(command.args.includes("scripts/import-mongodb-shadow.ts"));
  assert.equal(command.env.DATABASE_URL, undefined);
  assert.equal(command.env.MONGODB_URI, configured.MONGODB_URI);
  assert.equal(command.env.RUN_DB_MIGRATIONS, "false");
});
test("shadow job rejects missing gates, migration startup, arbitrary scripts and path escapes", () => {
  for (const args of [[], ["server.js"], ["export", "plaintext"], ["export", "plaintext", "--allow-read-only-source-export", "extra"],
    ["import", "/etc/mongo-shadow-fixture", "id", "--apply-shadow-only"], ["import", "/spool/../mongo-shadow-fixture", "id", "--apply-shadow-only"]]) {
    assert.throws(() => shadowJobCommand(args, configured), /SHADOW_JOB_CONFIGURATION_INVALID/);
  }
  for (const changes of [{RUN_DB_MIGRATIONS: "true"}, {PII_INDEX_KEY: ""}, {DATABASE_URL: ""}]) {
    assert.throws(() => shadowJobCommand(["export", "plaintext", "--allow-read-only-source-export"], {...configured, ...changes}));
  }
  for (const changes of [{MONGODB_SHADOW_DATABASE: "hub-om"}, {MONGODB_PRODUCTION_DATABASE: "hub-om-shadow-validation"}, {MONGODB_ALLOW_SHADOW_WRITES: "false"}]) {
    assert.throws(() => shadowJobCommand(["import", "/spool/mongo-shadow-fixture", "id", "--apply-shadow-only"], {...configured, ...changes}));
  }
});
