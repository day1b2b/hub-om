import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import { MongoClient } from "mongodb";
import { prepareMongoAnnouncementRuntime } from "./mongoAnnouncementRuntime";

const uri = process.env.MONGODB_ANNOUNCEMENT_COMPOSITION_TEST_URI;
const admin = { user: { email: "synthetic.announcement.admin@day1company.co.kr", name: "Synthetic Admin" }, expires: "" };
let actor: typeof admin | null = admin;
let pgCalls = 0;

mock.module("@/auth", { namedExports: { auth: async () => actor } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("PG_FORBIDDEN"); } } });

const ui = new Map<string, string>([
  ["@/components/AppSidebar", "AppSidebar"],
  ["@/features/announcements/AnnouncementList", "AnnouncementList"],
  ["@/features/announcements/AnnouncementActions", "AnnouncementActions"],
  ["@/features/announcements/AnnouncementForm", "AnnouncementForm"]
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const name = ui.get(specifier);
    if (name) return { url: `data:text/javascript,export function ${name}(){return null;}`, shortCircuit: true };
    if (specifier === "next/link") return { url: "data:text/javascript,export default function Link(){return null;}", shortCircuit: true };
    return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return {
      format: "module",
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText,
      shortCircuit: true
    };
    return next(url, context);
  }
});
const collectionRoute = await import("../../app/api/announcements/route");
const itemRoute = await import("../../app/api/announcements/[id]/route");
const attachmentRoute = await import("../../app/api/announcements/[id]/attachments/[attachmentId]/route");
const { default: listPage } = await import("../../app/announcements/page");
const { default: detailPage } = await import("../../app/announcements/[id]/page");
const { default: editPage } = await import("../../app/announcements/[id]/edit/page");
hooks.deregister();

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function component(node: ReactNode, name: string) {
  const matches = elements(node).filter(element => typeof element.type === "function" && element.type.name === name);
  assert.equal(matches.length, 1);
  return matches[0];
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const attachmentContext = (id: string, attachmentId: string) => ({ params: Promise.resolve({ id, attachmentId }) });
function form(title = "Synthetic announcement") {
  const value = new FormData();
  value.set("title", title);
  value.set("content", "<p>Synthetic content</p>");
  value.append("files", new File([new Uint8Array([0, 255, 128])], "synthetic.bin", { type: "application/octet-stream" }));
  return value;
}

async function snapshot(client: MongoClient, databaseName: string) {
  const value: Record<string, unknown> = {};
  const collections = await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray();
  for (const item of collections.sort((left, right) => left.name.localeCompare(right.name))) {
    const collection = client.db(databaseName).collection(item.name);
    value[item.name] = {
      options: item.options,
      indexes: await collection.listIndexes().toArray(),
      rows: await collection.find({}).sort({ _id: 1 }).toArray()
    };
  }
  return value;
}

test("announcement pages and APIs use one prepared Mongo composition", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!);
  assert.equal(target.hostname, "127.0.0.1");
  assert.ok(target.port);
  const databaseName = `hub_om_shadow_announcement_composition_${randomBytes(6).toString("hex")}`;
  const namespace = `shadow_announcements_${randomBytes(6).toString("hex")}`;
  const environment = {
    ANNOUNCEMENT_BACKEND: "mongodb-shadow",
    MONGODB_URI: uri!,
    MONGODB_SHADOW_DATABASE: databaseName,
    MONGODB_SHADOW_NAMESPACE: namespace,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ALLOW_PLAINTEXT_READS: "false",
    ADMIN_EMAILS: admin.user.email,
    DEV_AUTH_BYPASS: "false",
    DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden"
  };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });

  try {
    await client.connect();
    await prepareMongoAnnouncementRuntime({ client, databaseName, namespace, allowShadowWrites: true });

    const createdResponse = await collectionRoute.POST(new Request("https://synthetic.invalid/api/announcements", { method: "POST", body: form() }));
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { announcement: { id: string } };
    const id = created.announcement.id;

    const itemResponse = await itemRoute.GET(new Request(`https://synthetic.invalid/api/announcements/${id}`), context(id));
    assert.equal(itemResponse.status, 200);
    const item = await itemResponse.json() as { announcement: { attachments: Array<{ id: string }> } };
    const attachmentId = item.announcement.attachments[0].id;

    assert.equal((await collectionRoute.GET()).status, 200);
    assert.equal(component(await listPage(), "AnnouncementList").props.loadFailed, false);
    assert.ok(await detailPage(context(id)));
    assert.ok(await editPage(context(id)));

    const download = await attachmentRoute.GET(
      new Request(`https://synthetic.invalid/api/announcements/${id}/attachments/${attachmentId}`),
      attachmentContext(id, attachmentId)
    );
    assert.equal(download.status, 200);
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), new Uint8Array([0, 255, 128]));

    const updated = await itemRoute.PUT(
      new Request(`https://synthetic.invalid/api/announcements/${id}`, { method: "PUT", body: form("Updated synthetic announcement") }),
      context(id)
    );
    assert.equal(updated.status, 200);
    assert.equal((await itemRoute.DELETE(new Request(`https://synthetic.invalid/api/announcements/${id}`, { method: "DELETE" }), context(id))).status, 200);
    assert.equal((await itemRoute.GET(new Request(`https://synthetic.invalid/api/announcements/${id}`), context(id))).status, 404);
    assert.equal(pgCalls, 0);

    const partialNamespace = `shadow_announcements_partial_${randomBytes(6).toString("hex")}`;
    process.env.MONGODB_SHADOW_NAMESPACE = partialNamespace;
    const legacy = client.db(databaseName).collection(`${partialNamespace}_LegacyOnly`);
    await client.db(databaseName).createCollection(legacy.collectionName, {
      validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error"
    });
    await legacy.createIndex({ marker: 1 }, { unique: true, name: "marker_unique" });
    await legacy.insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName);
    await assert.rejects(collectionRoute.GET(), /^Error: ANNOUNCEMENT_COMPOSITION_FAILED$/);
    const failedList = component(await listPage(), "AnnouncementList");
    assert.equal(failedList.props.loadFailed, true);
    await assert.rejects(detailPage(context(randomUUID())), /^Error: ANNOUNCEMENT_COMPOSITION_FAILED$/);
    assert.deepEqual(await snapshot(client, databaseName), before);
    assert.equal(pgCalls, 0);
  } finally {
    actor = admin;
    try { await client.db(databaseName).dropDatabase(); } catch {}
    await client.close();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
