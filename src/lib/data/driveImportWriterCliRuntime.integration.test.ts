import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { parseDriveImportArgs, runDriveImportDryRun } from "../driveImports/driveImportDryRun";
import type { DriveImportSource } from "./driveImportSource";
import type { DriveImportOperation } from "./driveImportWriterRepository";
import { runDriveImportWriterCli, type DriveImportWriterCliDependencies } from "./driveImportWriterCliRuntime";
import { seedRow } from "./driveImportWriterTransactionHarness.fixture";
import { DRIVE_IMPORT_WRITER_MODELS, prepareMongoDriveImportWriter } from "./mongoDriveImportWriterRepository";
import { openMongoDriveImportWriterRuntime } from "./mongoDriveImportWriterRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_DRIVE_IMPORT_CLI_TEST_URI;
const repository = new URL("../../../", import.meta.url);
async function snapshotNamespace(client: MongoClient, databaseName: string, prefix: string) {
  const result: Record<string, unknown> = {};
  const infos = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray())
    .filter(info => info.name.startsWith(prefix)).sort((a, b) => a.name.localeCompare(b.name));
  for (const info of infos) { const collection = client.db(databaseName).collection(info.name); result[info.name] = { info, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() }; }
  return result;
}

async function actualMongoCli(environment: NodeJS.ProcessEnv, namespace: string) {
  const owned = mkdtempSync(join(tmpdir(), "hub-om-drive-mongo-cli-"));
  const observer = join(owned, "observer.jsonl");
  writeFileSync(observer, "");
  try {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--experimental-loader", fileURLToPath(new URL("scripts/ts-loader.mjs", repository)),
      "--import", new URL("driveImportWriterMongoCli.fixture.ts", import.meta.url).href,
      fileURLToPath(new URL("scripts/run-drive-import-dry-run.mjs", repository)), "--limit", "1", "--backend=mongodb-shadow"], {
      cwd: fileURLToPath(repository), env: { PATH: process.env.PATH, TZ: "UTC", NODE_ENV: "test", NODE_NO_WARNINGS: "1", MONGODB_URI: environment.MONGODB_URI,
        MONGODB_SHADOW_DATABASE: environment.MONGODB_SHADOW_DATABASE, MONGODB_SHADOW_NAMESPACE: namespace,
        PII_ENCRYPTION_KEYS: environment.PII_ENCRYPTION_KEYS, PII_ACTIVE_KEY_ID: environment.PII_ACTIVE_KEY_ID,
        PII_INDEX_KEY: environment.PII_INDEX_KEY, PII_ALLOW_PLAINTEXT_READS: "false", DRIVE_IMPORT_MONGO_CLI_OBSERVER: observer },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    child.stdout.on("data", data => stdout.push(Buffer.from(data))); child.stderr.on("data", data => stderr.push(Buffer.from(data)));
    let timedOut = false; const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 15_000);
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
    clearTimeout(timer); assert.equal(timedOut, false); assert.equal(exit.signal, null);
    const events = readFileSync(observer, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { event: string; value: unknown });
    return { code: exit.code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), events };
  } finally { rmSync(owned, { recursive: true, force: true }); }
}

test("Drive import real CLI selector writes only to a prepared Mongo shadow", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const seedClient = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_drive_cli_${randomBytes(8).toString("hex")}`;
  const namespace = `shadow_drive_cli_${randomBytes(8).toString("hex")}`;
  const names = ["DATABASE_URL", "MONGODB_URI", "MONGODB_SHADOW_DATABASE", "MONGODB_SHADOW_NAMESPACE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  let sourceCalls = 0;
  const source: DriveImportSource = Object.freeze({ async scan() { throw new Error("scan must not run"); }, async search(operation: DriveImportOperation) { sourceCalls++; assert.equal(operation.operationId, "SYNTHETIC-DRIVE-CLI-1"); return { candidates: [], issues: [], searchedAt: "2099-01-01T00:00:00.000Z" }; } });
  const dependencies: DriveImportWriterCliDependencies = {
    createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()), source,
    openRuntime: input => openMongoDriveImportWriterRuntime({ ...input, client: input.client as MongoClient }),
    parseArgs: parseDriveImportArgs, runWorkflow: runDriveImportDryRun,
    getDefaultWriter() { throw new Error("PostgreSQL writer must not resolve"); },
  };
  try {
    delete process.env.DATABASE_URL;
    Object.assign(process.env, { MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace,
      PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
      PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
    await seedClient.connect();
    const options = { client: seedClient, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoDriveImportWriter(options);
    const store = new MongoOperationStore(options, DRIVE_IMPORT_WRITER_MODELS);
    const companyId = randomUUID(), courseId = randomUUID(), operationId = randomUUID();
    await store.collection("Company").insertOne(encodeMongoRuntimeDocument("Company", seedRow("Company", { id: companyId, name: "Synthetic private drive company", normalizedName: "synthetic-private-drive-company" })));
    await store.collection("Course").insertOne(encodeMongoRuntimeDocument("Course", seedRow("Course", { id: courseId, companyId, courseId: "SYNTHETIC-COURSE", name: "Synthetic private drive course" })));
    await store.collection("OperationSession").insertOne(encodeMongoRuntimeDocument("OperationSession", seedRow("OperationSession", { id: operationId, operationId: "SYNTHETIC-DRIVE-CLI-1", courseRecordId: courseId, startDate: new Date("2099-01-01"), endDate: new Date("2099-01-02"), deletedAt: null, driveLink: "", lectureManagementLink: "" })));
    const result = await runDriveImportWriterCli(["--limit", "1", "--backend=mongodb-shadow"], process.env, () => { throw new Error("PG env must not load"); }, undefined, dependencies);
    assert.equal(result.status, "completed"); assert.equal(sourceCalls, 1);
    assert.equal(await store.collection("DriveImportRun").countDocuments(), 1); assert.equal(await store.collection("DriveImportResult").countDocuments(), 1);
    const rawResult = JSON.stringify(await store.collection("DriveImportResult").find({}).toArray());
    assert.equal(rawResult.includes("Synthetic private drive company"), false); assert.equal(rawResult.includes("Synthetic private drive course"), false);

    const childSuccess = await actualMongoCli(process.env, namespace);
    assert.equal(childSuccess.code, 0, `${childSuccess.stderr}:${childSuccess.stdout}:${JSON.stringify(childSuccess.events)}`); assert.equal(childSuccess.stderr, ""); assert.match(childSuccess.stdout, /"status": "completed"/);
    assert.deepEqual(childSuccess.events, [{ event: "search", value: "SYNTHETIC-DRIVE-CLI-1" }]);
    assert.equal(await store.collection("DriveImportRun").countDocuments(), 2); assert.equal(await store.collection("DriveImportResult").countDocuments(), 2);

    const partial = `shadow_partial_${randomBytes(6).toString("hex")}`, prefix = `${partial}_`;
    await seedClient.db(databaseName).createCollection(`${partial}_LegacyOnly`, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    const legacy = seedClient.db(databaseName).collection(`${partial}_LegacyOnly`); await legacy.createIndex({ marker: 1 }, { unique: true, name: "legacy_marker_unique" }); await legacy.insertOne({ marker: "unchanged" });
    const before = await snapshotNamespace(seedClient, databaseName, prefix);
    const childFailure = await actualMongoCli(process.env, partial);
    assert.equal(childFailure.code, 1); assert.equal(childFailure.stdout, ""); assert.equal(childFailure.stderr, "DRIVE_IMPORT_WRITER_FAILED\n");
    assert.deepEqual(childFailure.events, []); assert.deepEqual(await snapshotNamespace(seedClient, databaseName, prefix), before); assert.equal(sourceCalls, 1);
  } finally {
    try { await seedClient.db(databaseName).dropDatabase(); } catch {} await seedClient.close();
    for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
