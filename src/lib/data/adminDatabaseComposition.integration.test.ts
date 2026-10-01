import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import { MongoClient } from "mongodb";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MONGO_ADMIN_DATABASE_RUNTIME_MODELS, prepareMongoAdminDatabaseRuntime } from "./mongoAdminDatabaseRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const uri = process.env.MONGODB_ADMIN_DATABASE_COMPOSITION_TEST_URI;
const admin = { user: { email: "synthetic.database.admin@day1company.co.kr", name: "Synthetic Admin" }, expires: "" };
let actor: typeof admin | null = admin;
let pgCalls = 0;
let localCalls = 0;
mock.module("@/auth", { namedExports: { auth: async () => actor } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("PG_FORBIDDEN"); } } });
mock.module("./localJsonTeamMemberRepository", { namedExports: { LocalJsonTeamMemberRepository: class {
  constructor() { localCalls++; throw new Error("LOCAL_FORBIDDEN"); }
} } });

const ui = new Map<string, string>([
  ["@/components/AppSidebar", "AppSidebar"],
  ...["AdminDatabaseGrid", "CourseDeletePanel", "DeletedOperationsPanel", "OmAssignmentStatusBackfillPanel", "OnsiteRequiredBackfillPanel"]
    .map(name => [`@/features/admin/${name}`, name] as const),
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./notionTeamMemberRepository") {
      return { url: "data:text/javascript,export function getNotionTeamMemberRepository(){throw new Error('EXTERNAL_FORBIDDEN')}", shortCircuit: true };
    }
    const name = ui.get(specifier);
    if (name) return { url: `data:text/javascript,export function ${name}(){return null;}`, shortCircuit: true };
    return next(["next/server", "next/navigation"].includes(specifier) ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return {
      format: "module",
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      shortCircuit: true,
    };
    return next(url, context);
  },
});
const { PATCH } = await import("../../app/api/admin/database/cell/route");
const { default: page } = await import("../../app/admin/database/page");
hooks.deregister();

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function component(node: ReactNode, name: string) {
  const found = elements(node).find(element => typeof element.type === "function" && element.type.name === name);
  assert.ok(found, `Expected ${name}`);
  return found;
}
const request = (body: unknown) => new Request("https://synthetic.invalid/api/admin/database/cell", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

async function snapshot(client: MongoClient, databaseName: string) {
  const output: Record<string, unknown> = {};
  for (const info of (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = client.db(databaseName).collection(info.name);
    output[info.name] = { info, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return output;
}

test("admin database page and PATCH use prepared Mongo composition", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!);
  assert.equal(target.hostname, "127.0.0.1");
  assert.ok(target.port);
  const databaseName = `hub_om_shadow_admin_database_composition_${randomBytes(6).toString("hex")}`;
  const namespace = `shadow_admin_database_${randomBytes(6).toString("hex")}`;
  const environment = {
    ADMIN_DATABASE_BACKEND: "mongodb-shadow",
    MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    ADMIN_EMAILS: admin.user.email, DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", DEV_AUTH_BYPASS: "false",
    OPERATION_DATA_SOURCE: "local",
  };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoAdminDatabaseRuntime(options);
    const store = new MongoOperationStore(options, MONGO_ADMIN_DATABASE_RUNTIME_MODELS);
    const company = coachFixtureRow("Company", { id: randomUUID(), name: "Synthetic company", normalizedName: "synthetic company" });
    await store.collection("Company").insertOne(encodeMongoRuntimeDocument("Company", company));

    const output = await page({ searchParams: Promise.resolve({ table: "companies" }) });
    const grid = component(output, "AdminDatabaseGrid");
    assert.equal((grid.props.selectedTable as { key: string }).key, "companies");
    const response = await PATCH(request({ table: "companies", rowId: company.id, field: "name", value: " Synthetic renamed company " }));
    assert.equal(response.status, 200);
    assert.equal((await store.one("Company", { _id: String(company.id) }))?.name, "Synthetic renamed company");
    const requestId = response.headers.get("X-Request-Id");
    assert.ok(requestId);
    assert.equal((await store.one("ActivityRequest", { _id: requestId }))?.status, 200);
    assert.ok((await store.scan("ActivityChange", { requestId })).some(row => row.targetId === company.id && row.action === "update"));
    assert.equal(pgCalls, 0);
    assert.equal(localCalls, 0);

    actor = null;
    await assert.rejects(page({ searchParams: Promise.resolve({}) }), error => typeof (error as { digest?: unknown }).digest === "string");
    await assert.rejects(PATCH(request({ table: "companies", rowId: company.id, field: "name", value: "denied" })), error => typeof (error as { digest?: unknown }).digest === "string");
    actor = admin;

    const partial = `shadow_admin_database_partial_${randomBytes(6).toString("hex")}`;
    process.env.MONGODB_SHADOW_NAMESPACE = partial;
    const legacy = client.db(databaseName).collection(`${partial}_LegacyOnly`);
    await client.db(databaseName).createCollection(legacy.collectionName, {
      validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error",
    });
    await legacy.createIndex({ marker: 1 }, { unique: true, name: "marker_unique" });
    await legacy.insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName);
    await assert.rejects(page({ searchParams: Promise.resolve({}) }), /ADMIN_DATABASE_COMPOSITION_FAILED/);
    assert.deepEqual(await snapshot(client, databaseName), before);
    assert.equal(pgCalls, 0);
    assert.equal(localCalls, 0);
  } finally {
    actor = admin;
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
