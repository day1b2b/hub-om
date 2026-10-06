import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { Collection, MongoClient, type Document } from "mongodb";
import { activityContext } from "../activity/context";
import { MongoOmRequestRepository, prepareMongoOmRequestStore, OM_REQUEST_MODELS } from "./mongoOmRequestRepository";
import { MongoOperationStore, completeMongoRow } from "./mongoOperationStore";
import { mongoRuntimeBlindIndex, encodeMongoRuntimeDocument, MongoJsonNull } from "./mongoRuntimeCodec";
import type { OmRequestInput } from "./omRequest/omRequestTypes";

const uri = process.env.MONGODB_OM_REQUEST_TEST_URI;
const privateText = "Synthetic private OM marker", actor = "synthetic-om@example.invalid";
const input = (): OmRequestInput => ({ team: "synthetic team", ld: privateText, company: "Synthetic company", trainingType: "오프라인", courseId: "SYNTHETIC", courseName: "Synthetic course", courseCategory: "Synthetic category", instructorName: privateText, syncupLink: "https://example.invalid/synthetic-private", driveLink: "https://example.invalid/synthetic-private", skillfloSetup: "N", skillmatchSetup: "N", onSiteOperation: "N", coachRequest: "N", resultReportNeeded: "N", totalSessions: 1, sessions: [{ date: "2099-01-01", timeStart: "09:00", timeEnd: "10:00", duration: "1", location: privateText }], notes: privateText });
function attributed<T>(work: () => Promise<T>, requestId = randomUUID()) {
  return activityContext.run({ requestId, actorEmail: actor, actorName: privateText, actorType: "user", route: "/api/om-request", method: "POST" }, work);
}
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; }
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic barrier timeout")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
const safe = (error: unknown) => { assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /Synthetic private|synthetic-om@/); assert.equal((error as Error & { cause?: unknown }).cause, undefined); return true; };

test("OM requests native CRUD transactions and concurrent metadata", { skip: !uri, timeout: 240_000 }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(key => [key, process.env[key]]));
  const keys = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: keys, PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const options = { client, databaseName: `hub_om_shadow_om_native_${randomBytes(8).toString("hex")}`, namespace: "shadow_om_native", allowShadowWrites: true as const };
  let connected = false, conflicts = 0;
  const commands: Document[] = [];
  client.on("commandStarted", event => { commands.push(event.command); });
  client.on("commandFailed", event => { if ((event.failure as { code?: number }).code === 112) conflicts++; });
  client.on("commandSucceeded", event => { for (const error of (event.reply as Document).writeErrors ?? []) if (error.code === 112) conflicts++; });
  try {
    await client.connect(); connected = true;
    await prepareMongoOmRequestStore(options);
    const repo = await MongoOmRequestRepository.open(options), store = new MongoOperationStore(options, OM_REQUEST_MODELS);
    const raw = async () => Promise.all(OM_REQUEST_MODELS.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray()));
    const create = () => attributed(() => repo.createOmRequest(input()));
    function hold(requestId: string) {
      const held = signal(), release = signal(); let reads = 0;
      const original = MongoOperationStore.prototype.one;
      const patch = mock.method(MongoOperationStore.prototype, "one", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["one"]>) {
        const result = await original.apply(this, args);
        if (this.namespace === options.namespace && args[0] === "OmRequest" && args[2] && activityContext.getStore()?.requestId === requestId && ++reads === 1) { held.resolve(); await bounded(release.promise); }
        return result;
      });
      return { held, release, patch, get reads() { return reads; } };
    }
    await suite.test("encrypted CRUD, companion indexes and redacted JSON rewrite audit", async () => {
      const row = await create(); assert.equal(row.ld, privateText); assert.equal(row.notes, privateText);
      await attributed(() => repo.setOmRequestSlackMeta(row.id, { ldEmail: actor, slackChannel: "synthetic-channel", slackThreadTs: "synthetic-thread" }));
      await attributed(() => repo.setOmRequestOperationId(row.id, "synthetic-operation"));
      const updated = await attributed(() => repo.updateOmRequest(row.id, { ...input(), courseName: "Changed course" }));
      assert.equal(updated?.ldEmail, actor); assert.equal(updated?.operationId, "synthetic-operation");
      const auditCount = await store.collection("ActivityChange").countDocuments();
      await attributed(() => repo.updateOmRequest(row.id, { ...input(), courseName: "Changed course" }));
      assert.equal(await store.collection("ActivityChange").countDocuments(), auditCount + 1);
      const latest = (await store.scan("ActivityChange")).filter(a => a.targetId === row.id && a.action === "update");
      assert.ok(latest.some(a => JSON.stringify(a.changes) === JSON.stringify({ sessions: { redacted: true } })));
      const stored = await store.collection("OmRequest").findOne({ _id: row.id }); assert.ok(stored);
      assert.match(stored.ld, /^pii:v1:/); assert.equal(stored.ldPiiIndex, mongoRuntimeBlindIndex("OmRequest", "ld", privateText));
      for (const value of [privateText, actor, "https://example.invalid/synthetic-private"]) assert.ok(!JSON.stringify(await raw()).includes(value));
      const unchanged = await raw(); await attributed(() => repo.setOmRequestSlackMeta(row.id, { ldEmail: "", slackChannel: "", slackThreadTs: "" }));
      assert.deepEqual(await raw(), unchanged);
      assert.equal((await repo.getOmRequest(row.id.toUpperCase()))?.id, row.id);
      assert.ok(await attributed(() => repo.deleteOmRequest(row.id))); assert.equal(await repo.getOmRequest(row.id), null);
      assert.equal(await repo.deleteOmRequest(row.id), false);
    });
    await suite.test("legacy encrypted JSON null maps to the original empty sessions DTO", async () => {
      const row = await create(), logical = await store.one("OmRequest", { _id: row.id }); assert.ok(logical);
      await store.collection("OmRequest").replaceOne({ _id: row.id }, encodeMongoRuntimeDocument("OmRequest", completeMongoRow("OmRequest", { ...logical, sessions: MongoJsonNull })));
      assert.deepEqual((await repo.getOmRequest(row.id))?.sessions, []);
      assert.deepEqual((await repo.listOmRequests()).find(item => item.id === row.id)?.sessions, []);
      assert.deepEqual((await repo.setOmRequestOperationId(row.id, "synthetic-null-json"))?.sessions, []);
    });
    for (const kind of ["update-meta", "meta-update", "update-delete", "delete-update"] as const) await suite.test(`actual read barrier and native retry: ${kind}`, async () => {
      const row = await create(), requestId = randomUUID(), barrier = hold(requestId), beforeConflicts = conflicts;
      const update = () => repo.updateOmRequest(row.id, { ...input(), notes: "Synthetic changed note" });
      const meta = () => repo.setOmRequestSlackMeta(row.id, { ldEmail: actor, slackChannel: "synthetic-concurrent-channel" });
      const remove = () => repo.deleteOmRequest(row.id);
      const first = kind.startsWith("update") ? update : kind.startsWith("meta") ? meta : remove;
      const second = kind.endsWith("meta") ? meta : kind.endsWith("delete") ? remove : update;
      const pending = attributed<unknown>(first, requestId);
      try {
        await bounded(barrier.held.promise); await attributed<unknown>(second); barrier.release.resolve(); await bounded(pending);
        assert.ok(conflicts > beforeConflicts, "real Mongo write conflict observed"); assert.ok(barrier.reads > 1, "retried from latest row");
        const current = await repo.getOmRequest(row.id);
        if (kind.includes("delete")) assert.equal(current, null);
        else { assert.equal(current?.notes, "Synthetic changed note"); assert.equal(current?.ldEmail, actor); assert.equal(current?.slackChannel, "synthetic-concurrent-channel"); }
        const changes = await store.scan("ActivityChange", { requestId });
        assert.equal(changes.length, kind === "update-delete" ? 0 : 1, "aborted attempt never leaves duplicate audit");
      } finally { barrier.release.resolve(); barrier.patch.mock.restore(); await pending.catch(() => {}); }
    });
    for (const action of ["create", "update", "delete"] as const) await suite.test(`audit failure rolls back ${action}`, async () => {
      const row = await create(), before = await raw();
      const original = Collection.prototype.insertOne;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        if (this.collectionName === store.collection("ActivityChange").collectionName) {
          if (action === "update") return original.call(this, { ...args[0], action: 42 }, args[1]);
          throw new Error(privateText);
        }
        return original.apply(this, args);
      });
      try { await assert.rejects(attributed<unknown>(() => action === "create" ? repo.createOmRequest(input()) : action === "update" ? repo.updateOmRequest(row.id, { ...input(), notes: "Synthetic changed" }) : repo.deleteOmRequest(row.id)), safe); }
      finally { patch.mock.restore(); }
      assert.deepEqual(await raw(), before);
    });
    await suite.test("wrong key, broken HMAC and ciphertext fail without writes", async () => {
      const row = await create(), before = await raw();
      process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
      try { await assert.rejects(repo.getOmRequest(row.id), safe); await assert.rejects(repo.updateOmRequest(row.id, input()), safe); }
      finally { process.env.PII_ENCRYPTION_KEYS = keys; }
      assert.deepEqual(await raw(), before);
      const original = await store.collection("OmRequest").findOne({ _id: row.id }); assert.ok(original);
      for (const changes of [{ ldPiiIndex: "f".repeat(64) }, { ld: original.notes }]) {
        await store.collection("OmRequest").updateOne({ _id: row.id }, { $set: changes });
        const corrupt = await raw(); await assert.rejects(repo.getOmRequest(row.id), safe); await assert.rejects(repo.setOmRequestOperationId(row.id, "other"), safe); assert.deepEqual(await raw(), corrupt);
        await store.collection("OmRequest").replaceOne({ _id: row.id }, original);
      }
    });
    await suite.test("one method deadline survives a real retry", async () => {
      const row = await create(), requestId = randomUUID(), barrier = hold(requestId), beforeConflicts = conflicts;
      const now = performance.now.bind(performance); let offset = 0;
      const clock = mock.method(performance, "now", () => now() + offset);
      const pending = attributed(() => repo.updateOmRequest(row.id, input()), requestId);
      try {
        await bounded(barrier.held.promise); await attributed(() => repo.setOmRequestOperationId(row.id, "concurrent-kept"));
        offset = 15_000; barrier.release.resolve();
        // On retry, expire the original call budget before a second business write.
        const original = Collection.prototype.updateOne;
        let hits = 0;
        const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          if (this.collectionName === store.collection("OmRequest").collectionName && activityContext.getStore()?.requestId === requestId && ++hits === 2) offset = 30_001;
          return original.apply(this, args);
        });
        try { await assert.rejects(bounded(pending), safe); } finally { patch.mock.restore(); }
        assert.ok(conflicts > beforeConflicts); assert.equal((await store.scan("ActivityChange", { requestId })).length, 0);
      } finally { offset = 0; clock.mock.restore(); barrier.release.resolve(); barrier.patch.mock.restore(); await pending.catch(() => {}); }
      assert.equal((await repo.getOmRequest(row.id))?.operationId, "concurrent-kept");
    });
    await suite.test("shadow gate, unprepared namespace and privacy configuration are required", async () => {
      await assert.rejects(MongoOmRequestRepository.open({ ...options, allowShadowWrites: false as true }), safe);
      await assert.rejects(MongoOmRequestRepository.open({ ...options, databaseName: "production" }), safe);
      await assert.rejects(MongoOmRequestRepository.open({ ...options, namespace: "shadow_missing" }), safe);
      const before = await raw(), indexKey = process.env.PII_INDEX_KEY; delete process.env.PII_INDEX_KEY;
      try { await assert.rejects(repo.createOmRequest(input()), safe); } finally { process.env.PII_INDEX_KEY = indexKey; }
      // Missing configuration must not change raw bytes.
      assert.deepEqual(await raw(), before);
    });
    assert.ok(commands.some(command => command.commitTransaction && command.writeConcern?.w === "majority" && command.writeConcern.j === true));
  } finally {
    if (connected) await client.db(options.databaseName).dropDatabase(); await client.close();
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
