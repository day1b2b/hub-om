import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { prepareMongoInstructorWikiRuntime, MONGO_INSTRUCTOR_WIKI_RUNTIME_MODELS } from "./mongoInstructorWikiRuntime";
import { MongoOperationStore } from "./mongoOperationStore";

const adminEmail = "instructor-wiki-admin@day1company.co.kr";
let session: { user: { email: string; name: string }; expires: string } | null = {
  user: { email: adminEmail, name: "Synthetic wiki admin" },
  expires: ""
};

mock.module("../../auth", { namedExports: { auth: async () => session } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { throw new Error("INSTRUCTOR_WIKI_PG_TRIPWIRE"); } } });
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
  }
});
const saveRoute = await import("../../app/api/instructor-wiki/save/route");
const linkRoute = await import("../../app/api/instructor-wiki/link/route");
hook.deregister();

const uri = process.env.MONGODB_INSTRUCTOR_WIKI_COMPOSITION_TEST_URI;
const request = (path: string, body: unknown) => new Request(`https://example.invalid${path}`, {
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" }
});

async function snapshot(client: MongoClient, databaseName: string, prefix: string) {
  const result: Record<string, unknown> = {};
  const collections = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray())
    .filter(item => item.name.startsWith(prefix))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const info of collections) {
    const collection = client.db(databaseName).collection(info.name);
    result[info.name] = {
      info,
      indexes: await collection.listIndexes().toArray(),
      rows: await collection.find({}).sort({ _id: 1 }).toArray()
    };
  }
  return result;
}

test("instructor wiki save and link routes use one selected Mongo scope", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!);
  assert.equal(target.hostname, "127.0.0.1");
  assert.ok(target.port);

  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_instructor_wiki_${randomBytes(8).toString("hex")}`;
  const namespace = `shadow_${randomBytes(8).toString("hex")}`;
  const names = [
    "DATABASE_URL", "OPERATION_DATA_SOURCE", "INSTRUCTOR_WIKI_BACKEND", "MONGODB_URI",
    "MONGODB_SHADOW_DATABASE", "MONGODB_SHADOW_NAMESPACE", "PII_ENCRYPTION_KEYS",
    "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DEV_AUTH_BYPASS"
  ];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  let connected = false;
  try {
    delete process.env.DATABASE_URL;
    delete process.env.OPERATION_DATA_SOURCE;
    delete process.env.DEV_AUTH_BYPASS;
    Object.assign(process.env, {
      INSTRUCTOR_WIKI_BACKEND: "mongodb-shadow",
      MONGODB_URI: uri!,
      MONGODB_SHADOW_DATABASE: databaseName,
      MONGODB_SHADOW_NAMESPACE: namespace,
      PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
      PII_ACTIVE_KEY_ID: "fixture",
      PII_INDEX_KEY: randomBytes(32).toString("base64"),
      PII_ALLOW_PLAINTEXT_READS: "false",
      ADMIN_EMAILS: adminEmail
    });

    await client.connect();
    connected = true;
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    const runtime = await prepareMongoInstructorWikiRuntime(options);
    await runtime.run(() => runtime.repositories.instructorNote.saveNote("Synthetic target instructor", {
      notionId: "11111111111111111111111111111111",
      notion: { syncedAt: "2026-10-01T00:00:00.000Z" }
    }));

    const savedResponse = await saveRoute.POST(request("/api/instructor-wiki/save", {
      name: "Synthetic source instructor",
      notes: "Synthetic private instructor note",
      recruitAvoid: true
    }));
    assert.equal(savedResponse.status, 200);
    assert.equal((await savedResponse.json()).saved.notes, "Synthetic private instructor note");

    const linkedResponse = await linkRoute.POST(request("/api/instructor-wiki/link", {
      name: "Synthetic source instructor",
      targetName: "Synthetic target instructor"
    }));
    assert.equal(linkedResponse.status, 200);
    assert.deepEqual(await linkedResponse.json(), { ok: true, linked: "Synthetic target instructor" });

    const check = await prepareMongoInstructorWikiRuntime(options);
    const source = await check.run(() => check.repositories.instructorNote.getNote("Synthetic source instructor"));
    assert.equal(source.notes, "Synthetic private instructor note");
    assert.equal(source.notionId, "11111111111111111111111111111111");

    const store = new MongoOperationStore(options, MONGO_INSTRUCTOR_WIKI_RUNTIME_MODELS);
    assert.equal(await store.collection("ActivityRequest").countDocuments(), 2);
    assert.equal(await store.collection("ActivityChange").countDocuments({ targetType: "instructor_notes" }), 2);
    const raw = JSON.stringify(await Promise.all(
      MONGO_INSTRUCTOR_WIKI_RUNTIME_MODELS.map(model => store.collection(model).find({}).toArray())
    ));
    for (const value of [
      adminEmail,
      "Synthetic wiki admin",
      "Synthetic source instructor",
      "Synthetic target instructor",
      "Synthetic private instructor note",
      "11111111111111111111111111111111"
    ]) assert.equal(raw.includes(value), false);

    session = null;
    await assert.rejects(
      saveRoute.POST(request("/api/instructor-wiki/save", { name: "Denied instructor", notes: "Must not save" })),
      (error: unknown) => error instanceof Error && String((error as Error & { digest?: unknown }).digest).includes("NEXT_REDIRECT")
    );
    assert.deepEqual(await check.run(() => check.repositories.instructorNote.getNote("Denied instructor")), {});
    assert.equal(await store.collection("ActivityRequest").countDocuments(), 3);

    const partial = `shadow_partial_${randomBytes(6).toString("hex")}`;
    const prefix = `${partial}_`;
    await client.db(databaseName).createCollection(`${partial}_LegacyOnly`, {
      validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error"
    });
    await client.db(databaseName).collection(`${partial}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName, prefix);
    process.env.MONGODB_SHADOW_NAMESPACE = partial;
    session = { user: { email: adminEmail, name: "Synthetic wiki admin" }, expires: "" };
    await assert.rejects(
      saveRoute.POST(request("/api/instructor-wiki/save", { name: "Partial instructor", notes: "Must not save" })),
      /INSTRUCTOR_WIKI_COMPOSITION_FAILED/
    );
    assert.deepEqual(await snapshot(client, databaseName, prefix), before);
  } finally {
    session = { user: { email: adminEmail, name: "Synthetic wiki admin" }, expires: "" };
    try {
      if (connected) await client.db(databaseName).dropDatabase();
    } finally {
      try { await client.close(); }
      finally {
        for (const name of names) {
          const value = saved.get(name);
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    }
  }
});
