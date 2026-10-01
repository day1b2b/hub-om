import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import ts from "typescript";
import { prepareMongoDriveImportHistory } from "./mongoDriveImportHistoryRepository";
import { MongoOperationStore } from "./mongoOperationStore";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";

const uri = process.env.MONGODB_DRIVE_IMPORT_PAGE_COMPOSITION_TEST_URI;
const user = { email: "synthetic.drive.page@day1company.co.kr", name: "Synthetic Drive Page" };
let actor: typeof user | null = user;
let pgCalls = 0;

mock.module("@/auth", { namedExports: { auth: async () => actor ? { user: actor, expires: "" } : null } });
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_FORBIDDEN"); } } } });

const hooks = registerHooks({
  resolve(specifier, context, next) {
    return next(["next/link", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) {
      return {
        format: "module",
        source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022
          }
        }).outputText,
        shortCircuit: true
      };
    }
    return next(url, context);
  }
});
const page = (await import("../../app/drive-import-runs/page")).default;
hooks.deregister();

async function snapshot(store: MongoOperationStore) {
  const value: Record<string, unknown> = {};
  const collections = await store.db.listCollections({}, { nameOnly: false }).toArray();
  for (const item of collections.sort((left, right) => left.name.localeCompare(right.name))) {
    const collection = store.db.collection(item.name);
    value[item.name] = {
      options: item.options,
      indexes: await collection.listIndexes().toArray(),
      rows: await collection.find({}).sort({ _id: 1 }).toArray()
    };
  }
  return value;
}

test("Drive import page uses one prepared Mongo read scope", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!);
  assert.equal(target.hostname, "127.0.0.1");
  assert.ok(target.port);
  const databaseName = `hub_om_shadow_drive_page_${randomBytes(6).toString("hex")}`;
  const namespace = `shadow_drive_page_${randomBytes(6).toString("hex")}`;
  const environment = {
    DRIVE_IMPORT_PAGE_BACKEND: "mongodb-shadow",
    MONGODB_URI: uri!,
    MONGODB_SHADOW_DATABASE: databaseName,
    MONGODB_SHADOW_NAMESPACE: namespace,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ALLOW_PLAINTEXT_READS: "false",
    DEV_AUTH_BYPASS: "false"
  };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoDriveImportHistory(options);
    await prepareMongoReadStore(options, TEAM_READ_MODELS);

    const pageTree = JSON.stringify(await page({ searchParams: Promise.resolve({}) }));
    assert.match(pageTree, /저장된 Drive 조회 결과가 없습니다/);
    assert.equal(pgCalls, 0);

    actor = null;
    await assert.rejects(
      page({ searchParams: Promise.resolve({}) }),
      error => error instanceof Error
        && (error as Error & { digest?: string }).digest === "NEXT_REDIRECT;replace;/sign-in;307;"
    );
    actor = user;

    const partialNamespace = `shadow_drive_page_partial_${randomBytes(6).toString("hex")}`;
    process.env.MONGODB_SHADOW_NAMESPACE = partialNamespace;
    await client.db(databaseName).createCollection(`${partialNamespace}_LegacyOnly`, {
      validator: { marker: { $type: "string" } },
      validationLevel: "strict",
      validationAction: "error"
    });
    await client.db(databaseName).collection(`${partialNamespace}_LegacyOnly`)
      .createIndex({ marker: 1 }, { unique: true, name: "marker_unique" });
    await client.db(databaseName).collection(`${partialNamespace}_LegacyOnly`)
      .insertOne({ marker: "unchanged" });
    const partial = new MongoOperationStore({ client, databaseName, namespace: partialNamespace });
    const before = await snapshot(partial);
    await assert.rejects(
      page({ searchParams: Promise.resolve({}) }),
      /^Error: DRIVE_IMPORT_PAGE_COMPOSITION_FAILED$/
    );
    assert.deepEqual(await snapshot(partial), before);
    assert.equal(pgCalls, 0);
  } finally {
    actor = user;
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
