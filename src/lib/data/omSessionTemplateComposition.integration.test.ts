import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import * as XLSX from "xlsx";
import { MONGO_IMPORT_TEMPLATE_MODELS, prepareMongoImportTemplateRuntime } from "./mongoImportStagingRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const actorEmail = "om-session-template@day1company.co.kr";
let session: { user: { email: string; name: string }; expires: string } | null = {
  user: { email: actorEmail, name: "Synthetic template user" },
  expires: ""
};
mock.module("../../auth", { namedExports: { auth: async () => session } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("OM_SESSION_TEMPLATE_PG_TRIPWIRE"); } } });
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
  }
});
const route = await import("../../app/api/om-request/session-template/route");
hook.deregister();

const uri = process.env.MONGODB_OM_SESSION_TEMPLATE_COMPOSITION_TEST_URI;
async function snapshot(client: MongoClient, databaseName: string, prefix: string) {
  const result: Record<string, unknown> = {};
  const collections = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray())
    .filter(item => item.name.startsWith(prefix)).sort((a, b) => a.name.localeCompare(b.name));
  for (const info of collections) {
    const collection = client.db(databaseName).collection(info.name);
    result[info.name] = { info, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return result;
}

test("OM session template route uses selected Mongo request audit", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!);
  assert.equal(target.hostname, "127.0.0.1");
  assert.ok(target.port);
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_om_template_${randomBytes(8).toString("hex")}`;
  const namespace = `shadow_${randomBytes(8).toString("hex")}`;
  const names = [
    "DATABASE_URL", "OM_SESSION_TEMPLATE_BACKEND", "MONGODB_URI", "MONGODB_SHADOW_DATABASE",
    "MONGODB_SHADOW_NAMESPACE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY",
    "PII_ALLOW_PLAINTEXT_READS", "DEV_AUTH_BYPASS"
  ];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  let connected = false;
  try {
    delete process.env.DATABASE_URL;
    delete process.env.DEV_AUTH_BYPASS;
    Object.assign(process.env, {
      OM_SESSION_TEMPLATE_BACKEND: "mongodb-shadow",
      MONGODB_URI: uri!,
      MONGODB_SHADOW_DATABASE: databaseName,
      MONGODB_SHADOW_NAMESPACE: namespace,
      PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
      PII_ACTIVE_KEY_ID: "fixture",
      PII_INDEX_KEY: randomBytes(32).toString("base64"),
      PII_ALLOW_PLAINTEXT_READS: "false"
    });

    await client.connect();
    connected = true;
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoImportTemplateRuntime(options);
    const response = await route.GET();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /spreadsheetml/);
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename*=UTF-8''${encodeURIComponent("OM업무요청_교육일정_샘플.xlsx")}`
    );
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
    assert.deepEqual(workbook.SheetNames, ["교육일정"]);
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets["교육일정"], { header: 1, defval: "" });
    assert.deepEqual(rows[0], ["회차", "시작일", "종료일", "시작시간", "종료시간", "장소", "실제교육일"]);
    assert.deepEqual(rows[1], ["1", "2026-08-12", "2026-08-13", "09:00", "18:00", "서울 강남구 ○○빌딩 3층", ""]);
    assert.equal(rows.length, 11);
    assert.deepEqual(rows[10], ["10", "", "", "", "", "", ""]);

    const store = new MongoOperationStore(options, MONGO_IMPORT_TEMPLATE_MODELS);
    const firstRequests = await store.collection("ActivityRequest").find({}).toArray();
    assert.equal(firstRequests.length, 1);
    const first = decodeMongoRuntimeDocument("ActivityRequest", firstRequests[0]);
    assert.equal(first.route, "/api/om-request/session-template");
    assert.equal(first.status, 200);

    session = null;
    await assert.rejects(
      route.GET(),
      (error: unknown) => error instanceof Error && String((error as Error & { digest?: unknown }).digest).includes("NEXT_REDIRECT")
    );
    const requests = await store.collection("ActivityRequest").find({}).toArray();
    assert.equal(requests.length, 2);
    assert.ok(requests.map(row => decodeMongoRuntimeDocument("ActivityRequest", row)).some(row => row.status === 307));
    const raw = JSON.stringify(await Promise.all(MONGO_IMPORT_TEMPLATE_MODELS.map(model => store.collection(model).find({}).toArray())));
    assert.equal(raw.includes(actorEmail), false);
    assert.equal(raw.includes("Synthetic template user"), false);

    const partial = `shadow_partial_${randomBytes(6).toString("hex")}`;
    const prefix = `${partial}_`;
    await client.db(databaseName).createCollection(`${partial}_LegacyOnly`, {
      validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error"
    });
    await client.db(databaseName).collection(`${partial}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName, prefix);
    process.env.MONGODB_SHADOW_NAMESPACE = partial;
    session = { user: { email: actorEmail, name: "Synthetic template user" }, expires: "" };
    await assert.rejects(
      route.GET(),
      /OM_SESSION_TEMPLATE_COMPOSITION_FAILED/
    );
    assert.deepEqual(await snapshot(client, databaseName, prefix), before);
  } finally {
    session = { user: { email: actorEmail, name: "Synthetic template user" }, expires: "" };
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await client.close(); }
      finally {
        for (const name of names) {
          const value = saved.get(name);
          if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
      }
    }
  }
});
