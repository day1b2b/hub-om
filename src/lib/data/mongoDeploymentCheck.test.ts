import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { checkMongoDeploymentEnvironment, MONGO_RUNTIME_BACKEND_SELECTORS, parseMongoDeploymentExpectation } from "./mongoDeploymentCheck";

const key = Buffer.alloc(32, 1).toString("base64"), index = Buffer.alloc(32, 2).toString("base64");
const mongoEnvironment = () => Object.fromEntries([
  ...MONGO_RUNTIME_BACKEND_SELECTORS.map(name => [name, "mongodb-shadow"]),
  ["MONGODB_URI", "mongodb://127.0.0.1:27017"], ["MONGODB_SHADOW_DATABASE", "hub_om_shadow_deployment"],
  ["MONGODB_SHADOW_NAMESPACE", "shadow_deployment"], ["PII_ENCRYPTION_KEYS", JSON.stringify({ fixture: key })],
  ["PII_ACTIVE_KEY_ID", "fixture"], ["PII_INDEX_KEY", index], ["RUN_DB_MIGRATIONS", "false"],
]);

test("deployment manifest matches every production composition selector and .env.example defaults", () => {
  const root = path.resolve("src/lib/data");
  const discovered = new Set<string>();
  for (const name of readdirSync(root).filter(name => name.endsWith("Composition.ts") && name !== "mongoShadowComposition.ts")) {
    for (const match of readFileSync(path.join(root, name), "utf8").matchAll(/\b(?:environment|env)\.([A-Z0-9_]+_BACKEND)\b/g)) discovered.add(match[1]);
  }
  assert.deepEqual([...discovered].sort(), [...MONGO_RUNTIME_BACKEND_SELECTORS].sort());
  const example = readFileSync(path.resolve(".env.example"), "utf8");
  for (const selector of MONGO_RUNTIME_BACKEND_SELECTORS) assert.match(example, new RegExp(`^${selector}="postgres"$`, "m"));
  assert.match(example, /^MONGODB_SHADOW_NAMESPACE=""$/m);
});

test("deployment preflight accepts only one exact declared state", () => {
  assert.deepEqual(checkMongoDeploymentEnvironment("postgres", {}), { readyFor: "postgres", selectorCount: 35 });
  const mongo = mongoEnvironment();
  assert.deepEqual(checkMongoDeploymentEnvironment("mongodb-shadow", mongo), { readyFor: "mongodb-shadow", selectorCount: 35 });
  for (const patch of [{ ACTIVITY_READ_BACKEND: "postgres" }, { ACTIVITY_READ_BACKEND: "mongo" }, { RUN_DB_MIGRATIONS: "true" },
    { PII_INDEX_KEY: key }, { PII_ACTIVE_KEY_ID: " fixture " }, { MONGODB_URI: "mongodb://127.0.0.1:not-a-port" },
    { MONGODB_URI: "mongodb+srv://example.invalid:27017" }]) {
    assert.throws(() => checkMongoDeploymentEnvironment("mongodb-shadow", { ...mongo, ...patch }), /^Error: MONGODB_DEPLOYMENT_CONFIGURATION_INVALID$/);
  }
  assert.throws(() => checkMongoDeploymentEnvironment("postgres", { ACTIVITY_READ_BACKEND: "mongodb-shadow" }), /MONGODB_DEPLOYMENT_CONFIGURATION_INVALID/);
});

test("deployment preflight requires one exact expectation argument", () => {
  assert.equal(parseMongoDeploymentExpectation(["--expect=postgres"]), "postgres");
  assert.equal(parseMongoDeploymentExpectation(["--expect=mongodb-shadow"]), "mongodb-shadow");
  for (const args of [[], ["--expect=mongo"], ["--expect=postgres", "extra"]]) assert.throws(() => parseMongoDeploymentExpectation(args));
});

test("actual deployment check prints only bounded status and fails closed", () => {
  const run = (expectation: string) => spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-loader", "./scripts/ts-loader.mjs",
    "scripts/check-mongodb-deployment.ts", expectation], { cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
    env: { PATH: process.env.PATH, NODE_ENV: "test", NODE_NO_WARNINGS: "1", PRIVATE_CANARY: "must-not-print" } });
  const postgres = run("--expect=postgres");
  assert.equal(postgres.status, 0); assert.equal(postgres.stderr, "");
  assert.deepEqual(JSON.parse(postgres.stdout), { readyFor: "postgres", selectorCount: 35 });
  const shadow = run("--expect=mongodb-shadow");
  assert.equal(shadow.status, 1); assert.equal(shadow.stdout, "");
  assert.deepEqual(JSON.parse(shadow.stderr), { readyFor: false, code: "MONGODB_DEPLOYMENT_CONFIGURATION_INVALID" });
  assert.equal(`${postgres.stdout}${postgres.stderr}${shadow.stdout}${shadow.stderr}`.includes("must-not-print"), false);
});
