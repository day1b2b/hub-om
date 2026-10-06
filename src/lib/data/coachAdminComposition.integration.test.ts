import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isValidElement } from "react";
import ts from "typescript";
import { MongoClient } from "mongodb";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MONGO_COACH_ADMIN_RUNTIME_MODELS, prepareMongoCoachAdminRuntime } from "./mongoCoachAdminRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_COACH_ADMIN_COMPOSITION_TEST_URI;
const admin = {
  user: { email: "synthetic.coach.admin@day1company.co.kr", name: "Synthetic Admin" },
  expires: "",
};
let actor: typeof admin | null = admin;
let pgCalls = 0;

mock.module("@/auth", { namedExports: { auth: async () => actor } });
mock.module("./prisma", {
  namedExports: {
    getPrismaClient: () => {
      pgCalls++;
      throw new Error("PG_FORBIDDEN");
    },
  },
});

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/features/coaches/CoachAdminPage") {
      return { url: "data:text/javascript,export const CoachAdminPage=()=>null;", shortCircuit: true };
    }
    return next(["next/server", "next/navigation"].includes(specifier) ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) {
      return {
        format: "module",
        source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        shortCircuit: true,
      };
    }
    return next(url, context);
  },
});
const fields = await import("../../app/api/master/fields/route");
const curriculums = await import("../../app/api/master/curriculums/route");
const deleted = await import("../../app/api/admin/deleted-coaches/route");
const { default: page } = await import("../../app/coaches/admin/page");
hooks.deregister();

const request = (method: string, body?: unknown) => new Request("https://synthetic.invalid/api", {
  method,
  ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});

async function snapshot(client: MongoClient, databaseName: string) {
  const output: Record<string, unknown> = {};
  const collections = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const item of collections) {
    const collection = client.db(databaseName).collection(item.name);
    output[item.name] = {
      options: item.options,
      indexes: await collection.listIndexes().toArray(),
      rows: await collection.find({}).sort({ _id: 1 }).toArray(),
    };
  }
  return output;
}

test("coach admin page and APIs use prepared Mongo composition", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!);
  assert.equal(target.hostname, "127.0.0.1");
  assert.ok(target.port);
  const databaseName = `hub_om_shadow_coach_admin_composition_${randomBytes(6).toString("hex")}`;
  const namespace = `shadow_coach_admin_${randomBytes(6).toString("hex")}`;
  const environment = {
    COACH_ADMIN_BACKEND: "mongodb-shadow",
    MONGODB_URI: uri!,
    MONGODB_SHADOW_DATABASE: databaseName,
    MONGODB_SHADOW_NAMESPACE: namespace,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ALLOW_PLAINTEXT_READS: "false",
    ADMIN_EMAILS: admin.user.email,
    DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden",
    DEV_AUTH_BYPASS: "false",
  };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoCoachAdminRuntime(options);
    const store = new MongoOperationStore(options, MONGO_COACH_ADMIN_RUNTIME_MODELS);
    const seedCoach = async (deletedAt: Date) => {
      const row = coachFixtureRow("Coach", {
        id: randomUUID(),
        name: "Synthetic deleted coach",
        normalizedName: "synthetic deleted coach",
        status: "INACTIVE",
        isActive: false,
        deletedAt,
        deletedBy: admin.user.email,
      });
      await store.collection("Coach").insertOne(encodeMongoRuntimeDocument("Coach", row));
      return String(row.id);
    };
    const restorableId = await seedCoach(new Date("2026-10-01T00:00:00.000Z"));
    const purgeableId = await seedCoach(new Date("2026-09-30T00:00:00.000Z"));

    const fieldResponse = await fields.POST(request("POST", { name: " 합성 분야 " }));
    assert.equal(fieldResponse.status, 201);
    const curriculumResponse = await curriculums.POST(request("POST", { name: " 합성 커리큘럼 " }));
    assert.equal(curriculumResponse.status, 201);
    assert.equal((await fields.GET()).status, 200);
    assert.equal((await curriculums.GET()).status, 200);
    assert.equal((await deleted.GET()).status, 200);
    const restoreResponse = await deleted.PUT(request("PUT", { id: restorableId.toUpperCase() }));
    assert.equal(restoreResponse.status, 200);
    const purgeResponse = await deleted.DELETE(request("DELETE", { id: purgeableId }));
    assert.equal(purgeResponse.status, 200);

    const output = await page({ searchParams: Promise.resolve({ tab: "deleted" }) });
    assert.ok(isValidElement(output));
    assert.equal((output.props as { deletedCount: number }).deletedCount, 0);
    assert.equal(await store.collection("CoachFieldMaster").countDocuments({ name: "합성 분야" }), 1);
    assert.equal(await store.collection("CoachCurriculumMaster").countDocuments({ name: "합성 커리큘럼" }), 1);
    assert.equal((await store.one("Coach", { _id: restorableId }))?.deletedAt, null);
    assert.equal(await store.collection("Coach").countDocuments({ _id: purgeableId }), 0);

    const writeResponses = [fieldResponse, curriculumResponse, restoreResponse, purgeResponse];
    for (const response of writeResponses) {
      const requestId = response.headers.get("X-Request-Id");
      assert.ok(requestId);
      assert.equal((await store.one("ActivityRequest", { _id: requestId }))?.status, response.status);
    }
    const changes = await store.scan("ActivityChange", {});
    assert.ok(changes.some(row => row.targetId === restorableId && row.action === "restore"));
    assert.ok(changes.some(row => row.targetId === purgeableId && row.action === "delete"));
    assert.equal(pgCalls, 0);

    actor = null;
    await assert.rejects(fields.GET(), error => typeof (error as { digest?: unknown }).digest === "string");
    actor = admin;
    const partial = `shadow_coach_admin_partial_${randomBytes(6).toString("hex")}`;
    process.env.MONGODB_SHADOW_NAMESPACE = partial;
    const legacy = client.db(databaseName).collection(`${partial}_LegacyOnly`);
    await client.db(databaseName).createCollection(legacy.collectionName, {
      validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error",
    });
    await legacy.insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName);
    await assert.rejects(fields.GET(), /COACH_ADMIN_COMPOSITION_FAILED/);
    assert.deepEqual(await snapshot(client, databaseName), before);
    assert.equal(pgCalls, 0);
  } finally {
    actor = admin;
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
