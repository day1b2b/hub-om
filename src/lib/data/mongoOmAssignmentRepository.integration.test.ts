import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { ClientSession, Collection, Db, MongoClient, MongoServerError, type Document } from "mongodb";
import { activityContext } from "../activity/context";
import { MongoOmAssignmentRepository, prepareMongoOmAssignmentStore, OM_ASSIGNMENT_MODELS } from "./mongoOmAssignmentRepository";
import { MongoOperationStore, MongoOperationError, completeMongoRow, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";
import { courseNameRestoreGuardCollection } from "./mongoCourseNameRestoreGuard";
import { OmAssignmentConflict } from "./omRequest/omAssignmentContract";
import { toOmRequest, type OmRequestRow } from "./omRequest/omRequestMapping";

const uri = process.env.MONGODB_OM_ASSIGNMENT_TEST_URI;
const actor = "synthetic-assignment@example.invalid", X = "Synthetic private assignee X", Y = "Synthetic private assignee Y";
const old = new Date("2020-01-01T00:00:00.000Z");
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic barrier timed out")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
function attributed<T>(work: () => Promise<T>, requestId = randomUUID()) {
  return activityContext.run({ requestId, actorType: "user", actorEmail: actor, actorName: X, route: "/api/om-request/assign", method: "PATCH" }, work);
}
function safe(error: unknown) { assert.ok(error instanceof MongoOperationError); assert.doesNotMatch(String(error), /Synthetic private|synthetic-assignment@example.invalid/); return true; }

test("confirmed OM assignment on native disposable Mongo replica", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const vars = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "AUTH_SECRET", "NEXTAUTH_SECRET"];
  const saved = new Map(vars.map(name => [name, process.env[name]]));
  const keys = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: keys, PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", AUTH_SECRET: randomBytes(32).toString("base64") });
  delete process.env.NEXTAUTH_SECRET;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_assignment_${randomBytes(8).toString("hex")}`;
  let connected = false, conflicts = 0, duplicates = 0, conflictSignal: ReturnType<typeof signal> | undefined;
  const observe = (code?: number) => { if (code === 112) { conflicts++; conflictSignal?.resolve(); } if (code === 11000) { duplicates++; conflictSignal?.resolve(); } };
  client.on("commandFailed", event => observe((event.failure as { code?: number }).code));
  client.on("commandSucceeded", event => { for (const error of (event.reply as Document).writeErrors ?? []) observe(error.code); });
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_assign_${randomBytes(6).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoOmAssignmentStore(options);
    const store = new MongoOperationStore(options, OM_ASSIGNMENT_MODELS), repo = await MongoOmAssignmentRepository.open(options);
    const insert = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    const rounds = await Promise.all([1, 2, 3].map(n => insert("OperationSession", { operationId: `SYNTHETIC-${randomUUID()}`, courseRecordId: "abcdefab-0000-4000-8000-000000000001", roundNo: String(n), omName: n === 1 ? Y : X, omUserId: null, operationStatus: "ASSIGNMENT_PLANNED", updatedAt: old, deletedAt: null })));
    const row = await insert("OmRequest", { assignedOm: X, status: "배정완료", team: "Synthetic team", operationId: rounds[0].operationId, totalSessions: 2, sessions: [{ date: "2099-01-01" }, { date: "2099-01-02" }], createdAt: old, notes: "Synthetic private notes" });
    const batch = randomUUID();
    for (const [model, target] of [["om_requests", row], ...rounds.slice(0, 2).map(round => ["operation_sessions", round])] as Array<[string, MongoRow]>) {
      await insert("ActivityChange", { requestId: batch, route: "/api/om-request", method: "POST", action: "create", targetType: model, targetId: target.id, actorEmail: actor, actorName: X, actorType: "user", changes: { hidden: { redacted: true } }, occurredAt: old });
    }
    const existing = toOmRequest(row as unknown as OmRequestRow);
    const snapshot = async () => ({ rows: await Promise.all(OM_ASSIGNMENT_MODELS.map(model => store.collection(model).find({}).sort({ _id: 1 }).toArray())), guard: await courseNameRestoreGuardCollection(store).find({}).toArray() });
    const replace = async (model: string, id: unknown, values: MongoRow) => {
      const previous = await store.one(model, { _id: String(id) }); assert.ok(previous);
      await store.collection(model).replaceOne({ _id: String(id) }, encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...previous, ...values })));
    };
    return { options, store, repo, rounds, row, existing, batch, snapshot, replace, insert };
  }
  try {
    await client.connect(); connected = true;
    await suite.test("preview reads creation metadata only and never writes guard or business", async () => {
      const f = await fixture(), before = await f.snapshot();
      const audit = await f.store.collection("ActivityChange").findOne({ targetType: "om_requests" }); assert.ok(audit);
      const request = await f.store.collection("OmRequest").findOne({ _id: f.row.id as string }); assert.ok(request);
      await f.store.collection("ActivityChange").updateOne({ _id: audit._id }, { $set: { changes: { $json: { __pii: request.notes } } } });
      const corrupt = await f.snapshot();
      const preview = await f.repo.previewOmAssignment(f.existing, X, actor);
      assert.equal(preview.count, 2); assert.equal(preview.nextOm, X); assert.match(preview.token, /^\d{13}\.[0-9a-f]{64}$/);
      assert.deepEqual(await f.snapshot(), corrupt, "privacy audit payload was neither decoded nor repaired");
      await f.store.collection("ActivityChange").replaceOne({ _id: audit._id }, audit);
      assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("metadata beyond the first driver batch uses bounded pages without getMore", async () => {
      const f = await fixture();
      const more = Array.from({ length: 100 }, (_, n) => coachFixtureRow("OperationSession", {
        operationId: `SYNTHETIC-${randomUUID()}`, courseRecordId: f.rounds[0].courseRecordId, roundNo: String(n + 3),
        omName: X, omUserId: null, operationStatus: "DONE", updatedAt: old, deletedAt: null
      }));
      await f.store.collection("OperationSession").insertMany(more.map(row => encodeMongoRuntimeDocument("OperationSession", row)));
      await f.store.collection("ActivityChange").insertMany(more.map(row => encodeMongoRuntimeDocument("ActivityChange", coachFixtureRow("ActivityChange", {
        requestId: f.batch, route: "/api/om-request", method: "POST", action: "create", targetType: "operation_sessions", targetId: row.id,
        actorEmail: actor, actorName: X, actorType: "user", changes: { hidden: { redacted: true } }, occurredAt: old
      }))));
      await f.replace("OmRequest", f.row.id, { totalSessions: 102, sessions: Array.from({ length: 102 }, () => ({ date: "2099-01-01" })) });
      const wire: string[] = [];
      // Snapshot helpers use ordinary nontransaction cursors; observe only
      // commands belonging to the actual preview/confirm transactions.
      const transactionListener = (event: { commandName: string; command: Document }) => { if (event.command.autocommit === false) wire.push(event.commandName); };
      client.on("commandStarted", transactionListener);
      try {
        const before = await f.snapshot();
        const preview = await f.repo.previewOmAssignment(f.existing, X, actor);
        assert.equal(preview.count, 102); assert.equal(new Set(preview.operations.map(row => row.operationId)).size, 102);
        assert.ok(wire.includes("find"));
        assert.equal(wire.includes("getMore"), false, "preview reads every metadata page without getMore");
        wire.length = 0;
        const result = await attributed(() => f.repo.assignOmRequestAtomically(f.existing, X, actor, preview.token));
        assert.deepEqual(result.operationIds, [f.rounds[0].operationId]);
        assert.ok(wire.includes("find")); assert.ok(wire.includes("update"));
        assert.equal(wire.includes("getMore"), false, "confirm reads every metadata page without getMore");
        assert.deepEqual((await f.snapshot()).rows[0], before.rows[0]);

        // Obtain a current token, then corrupt only a creation link on the last
        // metadata page. The rejection must come from re-reading that page.
        const current = await f.repo.previewOmAssignment(result.updated, X, actor);
        const metadata = await f.store.collection("ActivityChange").find({
          requestId: f.batch, route: "/api/om-request", method: "POST", action: "create",
          targetType: { $in: ["om_requests", "operation_sessions"] }
        }, { projection: { _id: 1, targetType: 1, targetId: 1 }, collation: { locale: "simple" } }).sort({ _id: 1 }).toArray();
        assert.equal(metadata.length, 103);
        const lastRound = [...metadata].reverse().find(row => row.targetType === "operation_sessions");
        assert.ok(lastRound); assert.ok(metadata.indexOf(lastRound) >= 100, "corrupt entry is beyond the first page");
        const duplicateTarget = f.rounds.slice(0, 2).find(row => row.id !== lastRound.targetId);
        assert.ok(duplicateTarget);
        const corrupted = await f.store.collection("ActivityChange").updateOne({ _id: lastRound._id }, { $set: { targetId: duplicateTarget.id } });
        assert.equal(corrupted.modifiedCount, 1);
        const corruptSnapshot = await f.snapshot();
        wire.length = 0;
        await assert.rejects(f.repo.previewOmAssignment(result.updated, X, actor), OmAssignmentConflict);
        assert.equal(wire.includes("getMore"), false);
        assert.deepEqual(await f.snapshot(), corruptSnapshot, "rejected preview leaves business, audit and guard unchanged");
        wire.length = 0;
        await assert.rejects(attributed(() => f.repo.assignOmRequestAtomically(result.updated, X, actor, current.token)), OmAssignmentConflict);
        assert.equal(wire.includes("getMore"), false);
        assert.deepEqual(await f.snapshot(), corruptSnapshot, "rejected confirm rolls back the guard without business or audit changes");
      } finally { client.off("commandStarted", transactionListener); }
    });
    await suite.test("manual names/accounts change wholly, DONE survives cancel, unrelated raw rows remain", async () => {
      const f = await fixture(); await f.replace("OperationSession", f.rounds[1].id, { omName: Y, omUserId: "Synthetic private account", operationStatus: "DONE" });
      const unrelated = await f.store.collection("OperationSession").findOne({ _id: f.rounds[2].id as string });
      const preview = await f.repo.previewOmAssignment(f.existing, "Synthetic private new", actor);
      const result = await attributed(() => f.repo.assignOmRequestAtomically(f.existing, "Synthetic private new", actor, preview.token));
      assert.deepEqual(result.operationIds.sort(), f.rounds.slice(0, 2).map(row => row.operationId).sort());
      for (const row of f.rounds.slice(0, 2)) {
        const current = await f.store.one("OperationSession", { _id: row.id as string }); assert.equal(current?.omName, "Synthetic private new"); assert.equal(current.omUserId, null);
      }
      const cancel = await f.repo.previewOmAssignment(result.updated, null, actor);
      await attributed(() => f.repo.assignOmRequestAtomically(result.updated, null, actor, cancel.token));
      const changed = await Promise.all(f.rounds.slice(0, 2).map(row => f.store.one("OperationSession", { _id: row.id as string })));
      assert.deepEqual(changed.map(row => [row?.omName, row?.omUserId, row?.operationStatus]), [[null, null, "ASSIGNMENT_NEEDED"], [null, null, "DONE"]]);
      assert.deepEqual(await f.store.collection("OperationSession").findOne({ _id: f.rounds[2].id as string }), unrelated);
      const raw = JSON.stringify(await f.snapshot()); for (const privateValue of [X, Y, actor, "Synthetic private new", "Synthetic private notes", "Synthetic private account"]) assert.ok(!raw.includes(privateValue));
      const logical = await f.store.one("OmRequest", { _id: f.row.id as string }); assert.equal(logical?.assignedOm, null);
    });
    await suite.test("request no-op still fixes a manual round; full no-op repeats token with only guard changes", async () => {
      const f = await fixture(), before = await f.snapshot();
      const preview = await f.repo.previewOmAssignment(f.existing, X, actor);
      const result = await attributed(() => f.repo.assignOmRequestAtomically(f.existing, X, actor, preview.token));
      assert.deepEqual(result.operationIds, [f.rounds[0].operationId]);
      assert.deepEqual((await f.snapshot()).rows[0], before.rows[0], "same request assignment is not rewritten");
      const again = await f.repo.previewOmAssignment(result.updated, X, actor), stable = await f.snapshot();
      for (let i = 0; i < 2; i++) {
        const result = await attributed(() => f.repo.assignOmRequestAtomically(f.existing, X, actor, again.token));
        assert.deepEqual(result.operationIds, []); assert.deepEqual((await f.snapshot()).rows, stable.rows);
      }
      assert.notDeepEqual((await f.snapshot()).guard, stable.guard);
    });
    for (const failure of ["round", "request", "audit"] as const) await suite.test(`native validator ${failure} failure rolls back guard, all business rows and audit`, async () => {
      const f = await fixture(), preview = await f.repo.previewOmAssignment(f.existing, "Synthetic private new", actor), before = await f.snapshot();
      const model = failure === "round" ? "OperationSession" : failure === "request" ? "OmRequest" : "ActivityChange";
      const second = [...f.rounds.slice(0, 2)].sort((a, b) => String(a.id).localeCompare(String(b.id)))[1];
      const extra = failure === "round" ? { $nor: [{ _id: second.id, omNamePiiIndex: mongoRuntimeBlindIndex("OperationSession", "omName", "Synthetic private new") }] }
        : failure === "request" ? { assignedOmPiiIndex: { $ne: mongoRuntimeBlindIndex("OmRequest", "assignedOm", "Synthetic private new") } } : { action: { $ne: "update" } };
      await f.store.db.command({ collMod: f.store.collection(model).collectionName, validator: { $and: [operationMongoValidator(model), extra] } });
      try { await assert.rejects(attributed(() => f.repo.assignOmRequestAtomically(f.existing, "Synthetic private new", actor, preview.token)), safe); assert.deepEqual(await f.snapshot(), before); }
      finally { await f.store.db.command({ collMod: f.store.collection(model).collectionName, validator: operationMongoValidator(model) }); }
    });
    await suite.test("invalid token and wrong key/HMAC reject without even committing guard", async () => {
      const f = await fixture(), preview = await f.repo.previewOmAssignment(f.existing, X, actor), before = await f.snapshot();
      for (const token of ["bad", `0000000000000.${"a".repeat(64)}`, `${Date.now() + 900000}.${"a".repeat(64)}`]) {
        await assert.rejects(f.repo.assignOmRequestAtomically(f.existing, X, actor, token), OmAssignmentConflict); assert.deepEqual(await f.snapshot(), before);
      }
      await assert.rejects(f.repo.assignOmRequestAtomically(f.existing, Y, actor, preview.token), OmAssignmentConflict);
      await assert.rejects(f.repo.assignOmRequestAtomically(f.existing, X, "another@example.invalid", preview.token), OmAssignmentConflict);
      process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
      try { await assert.rejects(f.repo.assignOmRequestAtomically(f.existing, X, actor, preview.token), safe); } finally { process.env.PII_ENCRYPTION_KEYS = keys; }
      assert.deepEqual(await f.snapshot(), before);
      await f.store.collection("OmRequest").updateOne({ _id: f.row.id as string }, { $set: { assignedOmPiiIndex: "f".repeat(64) } });
      const corrupt = await f.snapshot(); await assert.rejects(f.repo.assignOmRequestAtomically(f.existing, X, actor, preview.token), safe); assert.deepEqual(await f.snapshot(), corrupt);
    });
    for (const [winnerTarget, firstGuard] of [[X, false], [Y, false], [X, true]] as const) await suite.test(`actual disjoint assignment cycle serializes: winner ${winnerTarget === X ? "X" : "Y"}, first guard ${firstGuard}`, async () => {
      const f = await fixture();
      if (!firstGuard) await courseNameRestoreGuardCollection(f.store).insertOne({ _id: "restore", nonce: randomUUID() });
      const tokenX = (await f.repo.previewOmAssignment(f.existing, X, actor)).token, tokenY = (await f.repo.previewOmAssignment(f.existing, Y, actor)).token;
      const winnerId = randomUUID(), loserId = randomUUID(), held = signal(), release = signal(); conflictSignal = signal();
      const initialConflicts = conflicts, initialDuplicates = duplicates;
      const original = MongoOperationStore.prototype.one; let holds = 0;
      const barrier = mock.method(MongoOperationStore.prototype, "one", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["one"]>) {
        const row = await original.apply(this, args);
        if (this.namespace === f.options.namespace && args[0] === "OmRequest" && args[2] && activityContext.getStore()?.requestId === winnerId && ++holds === 1) { held.resolve(); await bounded(release.promise); }
        return row;
      });
      const winner = attributed(() => f.repo.assignOmRequestAtomically(f.existing, winnerTarget, actor, winnerTarget === X ? tokenX : tokenY), winnerId);
      let loser: Promise<unknown> | undefined;
      try {
        await bounded(held.promise);
        loser = attributed(() => f.repo.assignOmRequestAtomically(f.existing, winnerTarget === X ? Y : X, actor, winnerTarget === X ? tokenY : tokenX), loserId);
        const rejection = assert.rejects(loser, OmAssignmentConflict);
        await bounded(conflictSignal.promise); release.resolve(); await bounded(winner); await bounded(rejection);
        if (!firstGuard) assert.ok(conflicts > initialConflicts, "server 112 observed, not an injected exception");
        else assert.ok(conflicts > initialConflicts || duplicates > initialDuplicates);
        for (const row of f.rounds.slice(0, 2)) assert.equal((await f.store.one("OperationSession", { _id: row.id as string }))?.omName, winnerTarget);
        assert.equal((await f.store.one("OmRequest", { _id: f.row.id as string }))?.assignedOm, winnerTarget);
        assert.equal((await f.store.scan("ActivityChange", { requestId: loserId })).length, 0);
        assert.equal((await f.store.scan("ActivityChange", { requestId: winnerId })).length, winnerTarget === X ? 1 : 2);
      } finally { release.resolve(); barrier.mock.restore(); conflictSignal = undefined; await winner.catch(() => {}); await loser?.catch(() => {}); }
    });
    await suite.test("first-guard duplicate branch restarts only guard attempts (injected 11000; native races tested separately)", async () => {
      const f = await fixture(), token = (await f.repo.previewOmAssignment(f.existing, X, actor)).token;
      const original = Collection.prototype.updateOne; let tries = 0;
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        if (this.collectionName === courseNameRestoreGuardCollection(f.store).collectionName && ++tries === 1) throw new MongoServerError({ code: 11000, message: "Synthetic private duplicate" });
        return original.apply(this, args);
      });
      try { await attributed(() => f.repo.assignOmRequestAtomically(f.existing, X, actor, token)); assert.equal(tries, 2); }
      finally { patch.mock.restore(); }
    });
    for (const mode of ["five-attempt-limit", "shared-deadline", "business-duplicate"] as const) await suite.test(`injected duplicate policy: ${mode}`, async () => {
      const f = await fixture(), token = (await f.repo.previewOmAssignment(f.existing, X, actor)).token, before = await f.snapshot();
      const original = Collection.prototype.updateOne, now = performance.now.bind(performance);
      let attempts = 0, businessWrites = 0, offset = 0;
      const clock = mock.method(performance, "now", () => now() + offset);
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        if (this.collectionName === courseNameRestoreGuardCollection(f.store).collectionName) {
          attempts++;
          if (mode !== "business-duplicate") {
            if (mode === "shared-deadline") offset += 16_000;
            throw new MongoServerError({ code: 11000, message: "Synthetic private guard duplicate" });
          }
        }
        if (this.collectionName === f.store.collection("OperationSession").collectionName) {
          businessWrites++;
          if (mode === "business-duplicate") throw new MongoServerError({ code: 11000, message: "Synthetic private business duplicate" });
        }
        return original.apply(this, args);
      });
      try {
        await assert.rejects(attributed(() => f.repo.assignOmRequestAtomically(f.existing, X, actor, token)), safe);
        assert.equal(attempts, mode === "five-attempt-limit" ? 5 : mode === "shared-deadline" ? 2 : 1);
        assert.equal(businessWrites, mode === "business-duplicate" ? 1 : 0);
      } finally { patch.mock.restore(); clock.mock.restore(); }
      assert.deepEqual(await f.snapshot(), before, "guard/business/audits roll back on bounded failure");
    });
    await suite.test("one call budget includes guard acquisition and rolls the guard back", async () => {
      const f = await fixture(), token = (await f.repo.previewOmAssignment(f.existing, X, actor)).token, before = await f.snapshot();
      const original = Collection.prototype.updateOne, now = performance.now.bind(performance); let offset = 0;
      const clock = mock.method(performance, "now", () => now() + offset);
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === courseNameRestoreGuardCollection(f.store).collectionName) offset = 30001;
        return result;
      });
      try { await assert.rejects(f.repo.assignOmRequestAtomically(f.existing, X, actor, token), safe); }
      finally { offset = 0; clock.mock.restore(); patch.mock.restore(); }
      assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("lost commit acknowledgement retries commit without replaying callback (fault injection)", async () => {
      const f = await fixture(), token = (await f.repo.previewOmAssignment(f.existing, X, actor)).token, id = randomUUID();
      const original = ClientSession.prototype.commitTransaction; let commits = 0, guardWrites = 0;
      const guardListener = (event: { commandName: string; command: Document }) => { if (event.commandName === "update" && event.command.update === courseNameRestoreGuardCollection(f.store).collectionName) guardWrites++; };
      client.on("commandStarted", guardListener);
      const patch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
        const result = await original.apply(this, args);
        if (activityContext.getStore()?.requestId === id && ++commits === 1) { const error = new MongoServerError({ code: 91, message: "Synthetic private lost acknowledgement" }); error.addErrorLabel("UnknownTransactionCommitResult"); throw error; }
        return result;
      });
      try { await attributed(() => f.repo.assignOmRequestAtomically(f.existing, X, actor, token), id); assert.equal(commits, 2); assert.equal(guardWrites, 1, "commit retry did not replay callback"); }
      finally { patch.mock.restore(); client.off("commandStarted", guardListener); }
      assert.equal((await f.store.scan("ActivityChange", { requestId: id })).length, 1);
    });
    await suite.test("unresolved commit acknowledgement returns a safe error without claiming rollback (fault injection)", async () => {
      const f = await fixture(), token = (await f.repo.previewOmAssignment(f.existing, X, actor)).token, id = randomUUID();
      const original = ClientSession.prototype.commitTransaction; let commits = 0;
      const patch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
        const result = await original.apply(this, args);
        if (activityContext.getStore()?.requestId === id) { commits++; const error = new MongoServerError({ code: 50, message: "Synthetic private unconfirmed acknowledgement" }); error.addErrorLabel("UnknownTransactionCommitResult"); throw error; }
        return result;
      });
      try { await assert.rejects(attributed(() => f.repo.assignOmRequestAtomically(f.existing, X, actor, token), id), safe); assert.equal(commits, 1); }
      finally { patch.mock.restore(); }
      assert.equal((await f.store.one("OperationSession", { _id: f.rounds[0].id as string }))?.omName, X);
      assert.equal((await f.store.scan("ActivityChange", { requestId: id })).length, 1, "commit outcome cannot be called rolled back");
    });
    await suite.test("explicit preparation, shadow, encryption and guard readiness are required", async () => {
      const f = await fixture();
      await assert.rejects(MongoOmAssignmentRepository.open({ ...f.options, allowShadowWrites: false as true }), safe);
      await assert.rejects(MongoOmAssignmentRepository.open({ ...f.options, databaseName: "production" }), safe);
      await assert.rejects(MongoOmAssignmentRepository.open({ ...f.options, namespace: "shadow_unprepared" }), safe);
      await courseNameRestoreGuardCollection(f.store).drop();
      await assert.rejects(MongoOmAssignmentRepository.open(f.options), safe);
      assert.equal(await f.store.db.listCollections({ name: courseNameRestoreGuardCollection(f.store).collectionName }).hasNext(), false);
    });
    for (const mode of ["business-validator", "business-index", "guard-validator", "guard-ttl", "non-replica-hello"] as const)
      await suite.test(`readiness refuses ${mode} without repair${mode === "non-replica-hello" ? " (hello fault injection)" : ""}`, async () => {
        const f = await fixture(), guard = courseNameRestoreGuardCollection(f.store);
        if (mode === "business-validator") await f.store.db.command({ collMod: f.store.collection("OmRequest").collectionName, validator: {} });
        if (mode === "business-index") {
          const expected = (await f.store.collection("OperationSession").listIndexes().toArray()).find(index => index.name !== "_id_");
          assert.ok(expected?.name);
          await f.store.db.command({ collMod: f.store.collection("OperationSession").collectionName, index: { name: expected.name, hidden: true } });
        }
        if (mode === "guard-validator") await f.store.db.command({ collMod: guard.collectionName, validator: {} });
        if (mode === "guard-ttl") await guard.createIndex({ nonce: 1 }, { expireAfterSeconds: 60 });
        const ddl = async () => {
          const collections = await f.store.db.listCollections({}, { nameOnly: false }).toArray();
          return Promise.all(collections.filter(entry => entry.name.startsWith(f.options.namespace + "_")).sort((a, b) => a.name.localeCompare(b.name))
            .map(async entry => ({ entry, indexes: await f.store.db.collection(entry.name).listIndexes().toArray() })));
        };
        const before = { data: await f.snapshot(), ddl: await ddl() }, writes: string[] = [];
        const listener = (event: { commandName: string }) => {
          if (["create", "createIndexes", "collMod", "drop", "dropIndexes", "insert", "update", "delete", "findAndModify"].includes(event.commandName)) writes.push(event.commandName);
        };
        const original = Db.prototype.command;
        const hello = mode === "non-replica-hello" ? mock.method(Db.prototype, "command", async function (this: Db, ...args: Parameters<Db["command"]>) {
          const result = await original.apply(this, args);
          if (args[0].hello) { const standalone = { ...result }; delete standalone.setName; return standalone; }
          return result;
        }) : undefined;
        client.on("commandStarted", listener);
        try { await assert.rejects(MongoOmAssignmentRepository.open(f.options), safe); }
        finally { hello?.mock.restore(); client.off("commandStarted", listener); }
        assert.deepEqual(writes, []);
        assert.deepEqual({ data: await f.snapshot(), ddl: await ddl() }, before);
      });
    console.log(`Native assignment wire evidence: 112=${conflicts}; 11000=${duplicates}. Injected duplicate/commit cases are separate.`);
  } finally {
    mock.restoreAll(); if (connected) await client.db(databaseName).dropDatabase(); await client.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
