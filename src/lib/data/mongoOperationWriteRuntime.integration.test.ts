import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { CALENDAR_ID, PRIVATE_MARKER, SyntheticCalendarRemote } from "./mongoCalendarHandlers.fixture";
import { MongoOperationStore, OPERATION_MODELS, operationMongoValidator } from "./mongoOperationStore";

type Actor = { user: { email: string; name: string }; expires: string };
const actor: Actor = { user: { email: "operation-writer@day1company.co.kr", name: "Synthetic operation writer" }, expires: "" };
const actors = new AsyncLocalStorage<Actor | null>();
const remotes = new AsyncLocalStorage<SyntheticCalendarRemote>();
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
mock.module("@/lib/sourceReads", { namedExports: { getOperationSourceReader: async () => ({ readDiscussionReferences: async () => ({ source: "discussion", status: "disabled", readAt: new Date(0).toISOString(), items: [], issues: [] }) }) } });
let pgAdapterCalls = 0, pgPoolCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgAdapterCalls++; throw new Error("PG_ADAPTER_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgPoolCalls++; throw new Error("PG_POOL_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgPoolCalls++; throw new Error("PG_POOL_TRIPWIRE"); } } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const { prepareMongoOperationWriteRuntime } = await import("./mongoOperationWriteRuntime");
const collectionRoute = await import("../../app/api/operations/route");
const itemRoute = await import("../../app/api/operations/[operationId]/route");
const roundsRoute = await import("../../app/api/operations/[operationId]/rounds/route");
const reorderRoute = await import("../../app/api/operations/[operationId]/rounds/reorder/route");
const driveApplyRoute = await import("../../app/api/operations/[operationId]/drive-import/apply/route");
const driveCandidatesRoute = await import("../../app/api/operations/[operationId]/drive-import/candidates/route");
const driveFoldersRoute = await import("../../app/api/operations/[operationId]/drive-import/folders/route");
const sourceRefreshRoute = await import("../../app/api/operations/[operationId]/source-reads/refresh/route");
const { resetAccessTokenCache } = await import("../googleCalendar/calendarWriteClient");
hooks.deregister();

const uri = process.env.MONGODB_OPERATION_WRITE_TEST_URI;
const compositionUri = process.env.MONGODB_OPERATION_WRITE_COMPOSITION_TEST_URI;
const request = (path: string, body: unknown, key?: string) => new Request(`https://example.invalid${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body),
});
type AuditExpectation = { id: string; route: string; method: string; status: number };

test("operation write runtime composes create, round, reorder, delete, Calendar and request audit", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.protocol, "mongodb:"); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const env = { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", OPERATION_DATA_SOURCE: "postgres", OPERATION_SOURCE_READER_MODULE: "", DEV_AUTH_BYPASS: "false", GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-calendar-client", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-calendar-secret", GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-calendar-refresh", GOOGLE_CAL_PART_CALENDARS: `1파트:${CALENDAR_ID}`, GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL: "", GOOGLE_DRIVE_PRIVATE_KEY: "", GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: "", GOOGLE_CALENDAR_PRIVATE_KEY: "", SLACK_BOT_TOKEN: "", SLACK_SEARCH_TOKEN: "", SLACK_CALENDAR_ALERT_EMAIL: "", GMAIL_DISCUSSION_MANUAL_ARCHIVE_FILE: "" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const remote = new SyntheticCalendarRemote(); let unscopedFetch = 0;
  const logs: string[] = [], recordLog = (...values: unknown[]) => { logs.push(values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ")); };
  const infoMock = mock.method(console, "info", recordLog), warnMock = mock.method(console, "warn", recordLog), errorMock = mock.method(console, "error", recordLog);
  const fetchMock = mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const scoped = remotes.getStore(); if (!scoped) { unscopedFetch++; throw new Error("EXTERNAL_FETCH_TRIPWIRE"); } return scoped.fetch(input, init);
  });
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [], mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { if (mutating.has(event.commandName)) writes.push(event); });
  const databaseName = `hub_om_shadow_operation_write_${randomBytes(8).toString("hex")}`, namespace = `shadow_operation_write_${randomBytes(6).toString("hex")}`;
  try {
    await client.connect(); resetAccessTokenCache();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const, processSequenceHighWater: 0 };
    const runtime = await prepareMongoOperationWriteRuntime(options);
    writes.length = 0; await prepareMongoOperationWriteRuntime(options); assert.deepEqual(writes.map(event => event.commandName), []);
    await runtime.repositories.teamUsers.createTeamUser({ name: "Synthetic Calendar OM", email: "calendar-om@example.invalid", slackId: "synthetic-om", team: "AX 1파트", role: "om" });
    const store = new MongoOperationStore(options, [...new Set([...OPERATION_MODELS, "CalendarEventLink", "ActivityRequest"])]);
    const invoke = <T>(work: () => T): T => runtime.run(() => actors.run(actor, () => remotes.run(remote, work)));
    const audits: AuditExpectation[] = [];
    async function checked(response: Response, route: string, method = "POST", status = 200) { assert.equal(response.status, status); const id = response.headers.get("X-Request-Id"); assert.ok(id); audits.push({ id, route, method, status }); return response.json() as Promise<Record<string, unknown>>; }
    const created = await checked(await invoke(() => collectionRoute.POST(request("/api/operations", { companyName: "Synthetic company", courseName: "Synthetic course", courseId: "SYN-WRITE", roundNo: "1", startDate: "2099-12-01", endDate: "2099-12-01", educationDates: "2099-12-01", educationDays: "1", trainingType: "오프라인", om: "Synthetic Calendar OM", onsiteRequired: "N" }, randomUUID()))), "/api/operations");
    const first = created.operation as { operationId: string }; assert.ok(first.operationId); assert.equal(remote.active().length, 1);
    const added = await checked(await invoke(() => roundsRoute.POST(request(`/api/operations/${first.operationId}/rounds`, { roundNo: "2", startDate: "2099-12-02", endDate: "2099-12-02", educationDates: "2099-12-02" }, randomUUID()), { params: Promise.resolve({ operationId: first.operationId }) })), "/api/operations/[operationId]/rounds");
    const second = added.operation as { operationId: string }; assert.ok(second.operationId); assert.equal(remote.active().length, 2);
    const reordered = await checked(await invoke(() => reorderRoute.POST(request(`/api/operations/${first.operationId}/rounds/reorder`, { orderedOperationIds: [second.operationId, first.operationId] }), { params: Promise.resolve({ operationId: first.operationId }) })), "/api/operations/[operationId]/rounds/reorder");
    assert.equal((reordered.changes as unknown[]).length, 2); assert.equal(remote.active().length, 2);
    const patchesBeforeApply = remote.calls("event", "PATCH").length;
    const apply = await checked(await invoke(() => driveApplyRoute.POST(request(`/api/operations/${first.operationId}/drive-import/apply`, { patches: [{ field: "region", value: "Synthetic revised region", action: "replace" }] }), { params: Promise.resolve({ operationId: first.operationId }) })), "/api/operations/[operationId]/drive-import/apply");
    assert.equal((apply.operation as { region: string }).region, "Synthetic revised region"); assert.equal(remote.active().length, 2);
    assert.equal(remote.calls("event", "PATCH").length, patchesBeforeApply + 1);
    assert.equal((remote.calls("event", "PATCH").at(-1)?.body as { location?: string }).location, "Synthetic revised region");
    const candidates = await checked(await invoke(() => driveCandidatesRoute.POST(request(`/api/operations/${first.operationId}/drive-import/candidates`, { folderUrl: "https://drive.google.com/drive/folders/synthetic-folder-id-12345" }), { params: Promise.resolve({ operationId: first.operationId }) })), "/api/operations/[operationId]/drive-import/candidates");
    assert.equal((candidates.result as { candidates: unknown[] }).candidates.length, 0); assert.ok((candidates.result as { issues: string[] }).issues.length > 0);
    const folders = await checked(await invoke(() => driveFoldersRoute.POST(new Request(`https://example.invalid/api/operations/${first.operationId}/drive-import/folders`, { method: "POST" }), { params: Promise.resolve({ operationId: first.operationId }) })), "/api/operations/[operationId]/drive-import/folders");
    assert.equal((folders.result as { candidates: unknown[] }).candidates.length, 0); assert.ok((folders.result as { issues: string[] }).issues.length > 0);
    const refreshed = await checked(await invoke(() => sourceRefreshRoute.POST(request(`/api/operations/${first.operationId}/source-reads/refresh`, { source: "all" }), { params: Promise.resolve({ operationId: first.operationId }) })), "/api/operations/[operationId]/source-reads/refresh");
    assert.equal(refreshed.status, "disabled"); assert.deepEqual(refreshed.discussionReferences, []);
    await checked(await invoke(() => itemRoute.DELETE(new Request(`https://example.invalid/api/operations/${first.operationId}`, { method: "DELETE" }), { params: Promise.resolve({ operationId: first.operationId }) })), "/api/operations/[operationId]", "DELETE");
    assert.equal(remote.active().length, 1);
    const deleted = await store.one("OperationSession", { operationId: first.operationId }); assert.ok(deleted?.deletedAt instanceof Date);
    assert.equal((await store.scan("CalendarEventLink", { operationId: first.operationId })).length, 0);

    const activeBeforeFailure = remote.active().length;
    remote.failPost = { ordinal: remote.calls("event", "POST").length + 1, mode: "before-apply", message: `${PRIVATE_MARKER}-create` };
    const failedCreate = await checked(await invoke(() => collectionRoute.POST(request("/api/operations", { companyName: "Synthetic failure company", courseName: "Synthetic failure course", courseId: "SYN-FAIL", roundNo: "1", startDate: "2099-12-10", endDate: "2099-12-10", educationDates: "2099-12-10", educationDays: "1", trainingType: "오프라인", om: "Synthetic Calendar OM", onsiteRequired: "N" }, randomUUID()))), "/api/operations");
    const failedFirst = failedCreate.operation as { operationId: string }; assert.ok(failedFirst.operationId);
    assert.ok(await store.one("OperationSession", { operationId: failedFirst.operationId })); assert.equal(remote.active().length, activeBeforeFailure);
    assert.equal((await store.scan("CalendarEventLink", { operationId: failedFirst.operationId })).length, 0);
    remote.failPost = undefined;
    const recoveryRound = await checked(await invoke(() => roundsRoute.POST(request(`/api/operations/${failedFirst.operationId}/rounds`, { roundNo: "2", startDate: "2099-12-11", endDate: "2099-12-11", educationDates: "2099-12-11" }, randomUUID()), { params: Promise.resolve({ operationId: failedFirst.operationId }) })), "/api/operations/[operationId]/rounds");
    const failedSecond = recoveryRound.operation as { operationId: string }; assert.ok(failedSecond.operationId);
    await checked(await invoke(() => reorderRoute.POST(request(`/api/operations/${failedFirst.operationId}/rounds/reorder`, { orderedOperationIds: [failedSecond.operationId, failedFirst.operationId] }), { params: Promise.resolve({ operationId: failedFirst.operationId }) })), "/api/operations/[operationId]/rounds/reorder");
    const recoveredLinks = await store.scan("CalendarEventLink", { operationId: failedFirst.operationId });
    assert.equal(recoveredLinks.length, 1); assert.equal(new Set(remote.active().map(event => event.id)).size, remote.active().length);

    remote.failDelete = { ordinal: remote.calls("event", "DELETE").length + 1, mode: "before-apply", message: `${PRIVATE_MARKER}-delete` };
    await checked(await invoke(() => itemRoute.DELETE(new Request(`https://example.invalid/api/operations/${failedFirst.operationId}`, { method: "DELETE" }), { params: Promise.resolve({ operationId: failedFirst.operationId }) })), "/api/operations/[operationId]", "DELETE");
    assert.ok((await store.one("OperationSession", { operationId: failedFirst.operationId }))?.deletedAt instanceof Date);
    assert.equal((await store.scan("CalendarEventLink", { operationId: failedFirst.operationId })).length, 1);
    assert.equal(remote.active().some(event => event.id === recoveredLinks[0].eventId), true);
    remote.failDelete = undefined;
    const cleanup = await checked(await invoke(() => itemRoute.DELETE(new Request(`https://example.invalid/api/operations/${failedFirst.operationId}`, { method: "DELETE" }), { params: Promise.resolve({ operationId: failedFirst.operationId }) })), "/api/operations/[operationId]", "DELETE");
    assert.equal(cleanup.calendarCleanup, "completed");
    assert.equal((await store.scan("CalendarEventLink", { operationId: failedFirst.operationId })).length, 0);
    assert.equal(remote.active().some(event => event.id === recoveredLinks[0].eventId), false);
    await checked(await invoke(() => itemRoute.DELETE(new Request(`https://example.invalid/api/operations/${failedFirst.operationId}`, { method: "DELETE" }), { params: Promise.resolve({ operationId: failedFirst.operationId }) })), "/api/operations/[operationId]", "DELETE", 404);

    for (const expected of audits) {
      const row = await store.one("ActivityRequest", { _id: expected.id }); assert.ok(row);
      assert.equal(row.route, expected.route); assert.equal(row.method, expected.method); assert.equal(row.status, expected.status);
      assert.equal(row.actorType, "user"); assert.equal(row.actorEmail, actor.user.email); assert.equal(row.actorName, actor.user.name);
    }
    const rawAudit = JSON.stringify(await store.collection("ActivityRequest").find({}).toArray());
    for (const secret of [actor.user.email, actor.user.name, "Synthetic company", "Synthetic course", "Synthetic failure company", "Synthetic failure course", "Synthetic Calendar OM"]) assert.equal(rawAudit.includes(secret), false);
    for (const secret of [actor.user.email, actor.user.name, "Synthetic company", "Synthetic course", "Synthetic failure company", "Synthetic failure course", PRIVATE_MARKER]) assert.equal(logs.join("\n").includes(secret), false);
    assert.equal(audits.length, 14); assert.equal(pgAdapterCalls, 0); assert.equal(pgPoolCalls, 0); assert.equal(unscopedFetch, 0); assert.deepEqual(remote.violations, []);
    const partialNamespace = `shadow_operation_write_partial_${randomBytes(6).toString("hex")}`;
    await client.db(databaseName).createCollection(`${partialNamespace}_OperationSession`); writes.length = 0;
    await assert.rejects(prepareMongoOperationWriteRuntime({ ...options, namespace: partialNamespace }), /MONGO_OPERATION_WRITE_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(event => event.commandName), []);
    const legacyNamespace = `shadow_operation_write_legacy_${randomBytes(6).toString("hex")}`, legacy = client.db(databaseName).collection(`${legacyNamespace}_Legacy`);
    await legacy.insertOne({ marker: "legacy-plaintext-must-remain-unchanged" }); const legacyBefore = await legacy.findOne({}); writes.length = 0;
    await assert.rejects(prepareMongoOperationWriteRuntime({ ...options, namespace: legacyNamespace }), /MONGO_OPERATION_WRITE_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await legacy.findOne({}), legacyBefore);

    const auditCollection = store.collection("ActivityRequest");
    await store.db.command({ collMod: auditCollection.collectionName, validator: { $and: [operationMongoValidator("ActivityRequest"), { status: { $lt: 0 } }] } });
    try {
      const response = await invoke(() => collectionRoute.POST(request("/api/operations", { companyName: "", courseName: "" })));
      assert.equal(response.status, 400); assert.ok(response.headers.get("X-Request-Id"));
    } finally { await store.db.command({ collMod: auditCollection.collectionName, validator: operationMongoValidator("ActivityRequest") }); }
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); fetchMock.mock.restore(); infoMock.mock.restore(); warnMock.mock.restore(); errorMock.mock.restore(); resetAccessTokenCache();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test("operation write routes use the prepared Mongo composition", { skip: !compositionUri, timeout: 180_000 }, async () => {
  const target=new URL(compositionUri!);assert.equal(target.hostname,"127.0.0.1");assert.ok(target.port);
  const databaseName=`hub_om_shadow_operation_write_comp_${randomBytes(6).toString("hex")}`,namespace=`shadow_operation_write_${randomBytes(6).toString("hex")}`;
  const env={OPERATION_WRITE_BACKEND:"mongodb-shadow",MONGODB_URI:compositionUri!,MONGODB_SHADOW_DATABASE:databaseName,MONGODB_SHADOW_NAMESPACE:namespace,PII_ENCRYPTION_KEYS:JSON.stringify({fixture:randomBytes(32).toString("base64")}),PII_ACTIVE_KEY_ID:"fixture",PII_INDEX_KEY:randomBytes(32).toString("base64"),PII_ALLOW_PLAINTEXT_READS:"false",DATABASE_URL:"postgresql://synthetic@127.0.0.1:1/forbidden",OPERATION_DATA_SOURCE:"postgres",DEV_AUTH_BYPASS:"false",GOOGLE_CAL_OAUTH_CLIENT_ID:"synthetic-calendar-client",GOOGLE_CAL_OAUTH_CLIENT_SECRET:"synthetic-calendar-secret",GOOGLE_CAL_OAUTH_REFRESH_TOKEN:"synthetic-calendar-refresh",GOOGLE_CAL_PART_CALENDARS:`1파트:${CALENDAR_ID}`};
  const saved=new Map(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);const client=new MongoClient(compositionUri!,{directConnection:true});const remote=new SyntheticCalendarRemote();
  const fetchMock=mock.method(globalThis,"fetch",async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{const scoped=remotes.getStore();if(!scoped)throw new Error("EXTERNAL_FETCH_TRIPWIRE");return scoped.fetch(input,init)});
  try{await client.connect();resetAccessTokenCache();const options={client,databaseName,namespace,allowShadowWrites:true as const,processSequenceHighWater:0};const runtime=await prepareMongoOperationWriteRuntime(options);await runtime.repositories.teamUsers.createTeamUser({name:"Synthetic Calendar OM",email:"calendar-om@example.invalid",slackId:"synthetic",team:"AX 1파트",role:"om"});const store=new MongoOperationStore(options,[...new Set([...OPERATION_MODELS,"ActivityRequest"])]);const invoke=<T>(work:()=>T)=>actors.run(actor,()=>remotes.run(remote,work));
    const createdResponse=await invoke(()=>collectionRoute.POST(request("/api/operations",{companyName:"Synthetic composition company",courseName:"Synthetic composition course",courseId:"SYN-COMP",roundNo:"1",startDate:"2099-11-01",endDate:"2099-11-01",educationDates:"2099-11-01",educationDays:"1",trainingType:"오프라인",om:"Synthetic Calendar OM",onsiteRequired:"N"},randomUUID())));assert.equal(createdResponse.status,200);const first=(await createdResponse.clone().json() as {operation:{operationId:string}}).operation;
    const addedResponse=await invoke(()=>roundsRoute.POST(request(`/api/operations/${first.operationId}/rounds`,{roundNo:"2",startDate:"2099-11-02",endDate:"2099-11-02",educationDates:"2099-11-02"},randomUUID()),{params:Promise.resolve({operationId:first.operationId})}));assert.equal(addedResponse.status,200);const second=(await addedResponse.clone().json() as {operation:{operationId:string}}).operation;
    const reorderResponse=await invoke(()=>reorderRoute.POST(request(`/api/operations/${first.operationId}/rounds/reorder`,{orderedOperationIds:[second.operationId,first.operationId]}),{params:Promise.resolve({operationId:first.operationId})}));assert.equal(reorderResponse.status,200);
    const deleteResponse=await invoke(()=>itemRoute.DELETE(new Request(`https://example.invalid/api/operations/${first.operationId}`,{method:"DELETE"}),{params:Promise.resolve({operationId:first.operationId})}));assert.equal(deleteResponse.status,200);assert.equal(remote.active().length,1);for(const response of[createdResponse,addedResponse,reorderResponse,deleteResponse]){const id=response.headers.get("X-Request-Id");assert.ok(id);assert.ok(await store.one("ActivityRequest",{_id:id}))}assert.equal(pgAdapterCalls,0);assert.equal(pgPoolCalls,0);
    const partial=`shadow_operation_write_partial_${randomBytes(6).toString("hex")}`;process.env.MONGODB_SHADOW_NAMESPACE=partial;const legacy=client.db(databaseName).collection(`${partial}_LegacyOnly`);await client.db(databaseName).createCollection(legacy.collectionName,{validator:{marker:{$type:"string"}},validationLevel:"strict",validationAction:"error"});await legacy.insertOne({marker:"unchanged"});await assert.rejects(invoke(()=>collectionRoute.POST(request("/api/operations",{companyName:"x",courseName:"x",roundNo:"1",startDate:"2099-01-01",endDate:"2099-01-01"},randomUUID()))),/OPERATION_WRITE_COMPOSITION_FAILED/);assert.equal((await legacy.findOne())?.marker,"unchanged");
  }finally{fetchMock.mock.restore();try{await client.db(databaseName).dropDatabase()}catch{}await client.close();for(const[key,value]of saved){if(value===undefined)delete process.env[key];else process.env[key]=value}}
});
