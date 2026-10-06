import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import { MongoClient } from "mongodb";
import { MONGO_USER_ADMIN_RUNTIME_MODELS, prepareMongoUserAdminRuntime } from "./mongoUserAdminRuntime";
import { MongoOperationStore } from "./mongoOperationStore";

const uri = process.env.MONGODB_USER_ADMIN_COMPOSITION_TEST_URI;
const admin = { user: { email: "synthetic.user.admin@day1company.co.kr", name: "Synthetic Admin" }, expires: "" };
let actor: typeof admin | null = admin;
let pgCalls = 0;
mock.module("@/auth", { namedExports: { auth: async () => actor } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("PG_FORBIDDEN"); } } });
const ui = new Map([["@/components/AppSidebar", "AppSidebar"], ["./UserManagement", "UserManagement"], ["./InstructorMemberPanel", "InstructorMemberPanel"], ["./PracticeCoachMemberPanel", "PracticeCoachMemberPanel"]]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/link") return { url: "data:text/javascript,export default function Link(){return null}", shortCircuit: true };
    const name = ui.get(specifier); if (name) return { url: `data:text/javascript,export function ${name}(){return null}`, shortCircuit: true };
    return next(["next/server", "next/navigation"].includes(specifier) ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    return next(url, context);
  },
});
const users = await import("../../app/api/admin/users/route");
const deletion = await import("../../app/api/admin/users/delete/route");
const team = await import("../../app/api/admin/users/team/route");
const role = await import("../../app/api/admin/users/role/route");
const lookup = await import("../../app/api/team-users/lookup/route");
const { default: page } = await import("../../app/admin/users/page");
hooks.deregister();

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] { if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement<Record<string, unknown>>(node)) return []; return [node, ...elements(node.props.children as ReactNode)]; }
function component(node: ReactNode, name: string) { const found = elements(node).find(element => typeof element.type === "function" && element.type.name === name); assert.ok(found); return found; }
const request = (path: string, method = "GET", body?: unknown, headers?: HeadersInit) => new Request(`https://synthetic.invalid${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function snapshot(client: MongoClient, databaseName: string) { const output: Record<string, unknown> = {}; for (const info of (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).sort((a,b)=>a.name.localeCompare(b.name))) { const collection = client.db(databaseName).collection(info.name); output[info.name] = { info, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() }; } return output; }

test("user admin page and APIs use prepared Mongo composition", { skip: !uri, timeout: 120_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const databaseName = `hub_om_shadow_user_admin_comp_${randomBytes(6).toString("hex")}`, namespace = `shadow_user_admin_${randomBytes(6).toString("hex")}`;
  const environment = { USER_ADMIN_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email, COURSE_LOOKUP_TOKEN: "synthetic-lookup-token", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", DEV_AUTH_BYPASS: "false" };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]])); Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    await prepareMongoUserAdminRuntime(options); const store = new MongoOperationStore(options, MONGO_USER_ADMIN_RUNTIME_MODELS);
    const responses: Response[] = [];
    const createdResponse = await users.POST(request("/api/admin/users", "POST", { name: " Synthetic member ", email: " Member@Example.invalid ", slackId: "private-slack", team: "AX 1파트", role: "om" }));
    responses.push(createdResponse); assert.equal(createdResponse.status, 201); const created = await createdResponse.clone().json() as { id: string; email: string };
    const output = await page({ searchParams: Promise.resolve({ tab: "ld-om" }) });
    assert.equal((component(output, "UserManagement").props.initialUsers as unknown[]).length, 1);
    const teamResponse = await team.POST(request("/api/admin/users/team", "POST", { id: created.id, team: "AX 2파트" })); responses.push(teamResponse); assert.equal(teamResponse.status, 200);
    const roleResponse = await role.POST(request("/api/admin/users/role", "POST", { ids: [created.id], role: "ld" })); responses.push(roleResponse); assert.deepEqual(await roleResponse.clone().json(), { count: 1 });
    const tokenResponse = await lookup.GET(request("/api/team-users/lookup", "GET", undefined, { authorization: "Bearer synthetic-lookup-token" })); responses.push(tokenResponse); assert.equal(tokenResponse.status, 200);
    const deletionResponse = await deletion.POST(request("/api/admin/users/delete", "POST", { ids: [created.id] })); responses.push(deletionResponse); assert.equal(deletionResponse.status, 500);
    assert.equal((await users.GET()).status, 200); assert.equal(await store.collection("TeamUser").countDocuments(), 1);
    for (const response of responses) { const id = response.headers.get("X-Request-Id"); assert.ok(id); assert.equal((await store.one("ActivityRequest", { _id: id }))?.status, response.status); }
    assert.equal(await store.collection("ActivityChange").countDocuments(), 3); assert.equal(pgCalls, 0);

    actor = null; assert.equal((await users.GET()).status, 403); await assert.rejects(page({ searchParams: Promise.resolve({}) }), error => typeof (error as { digest?: unknown }).digest === "string"); actor = admin;
    const partial = `shadow_user_admin_partial_${randomBytes(6).toString("hex")}`; process.env.MONGODB_SHADOW_NAMESPACE = partial;
    const legacy = client.db(databaseName).collection(`${partial}_LegacyOnly`); await client.db(databaseName).createCollection(legacy.collectionName, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" }); await legacy.insertOne({ marker: "unchanged" });
    const before = await snapshot(client, databaseName); await assert.rejects(users.GET(), /USER_ADMIN_COMPOSITION_FAILED/); assert.deepEqual(await snapshot(client, databaseName), before); assert.equal(pgCalls, 0);
  } finally { actor = admin; try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
