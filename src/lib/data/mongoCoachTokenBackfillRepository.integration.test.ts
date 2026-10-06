import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { AbstractCursor, BSON, Collection, MongoClient, MongoServerError, type CommandStartedEvent, type CommandSucceededEvent } from "mongodb";
import { COACH_TOKEN_BACKFILL_MODELS, MongoCoachTokenBackfillRepository, prepareMongoCoachTokenBackfillStore } from "./mongoCoachTokenBackfillRepository";
import { completeMongoRow, MongoOperationError, MongoOperationStore, operationMongoIndexes, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex, MongoJsonNull } from "./mongoRuntimeCodec";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { runCoachTokenBackfillCommand } from "./coachTokenBackfillCommand";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { activityContext } from "../activity/context";
import { isEncrypted } from "../privacy/crypto";
import { coachTokenBackfillFixtures, expectedBackfilledTokens, expectedTokenBackfillApply, expectedTokenBackfillDryRun, expectedTokenBackfillRerun, TOKEN_BACKFILL_IDS as ids, TOKEN_BACKFILL_UPDATED_AT, tokenBackfillId, tokenBackfillSource } from "./coachTokenBackfillFixtures";

const uri = process.env.MONGODB_COACH_TOKEN_BACKFILL_TEST_URI;
const actor = () => ({ requestId: randomUUID(), actorType: "user" as const, actorEmail: "synthetic-backfill@example.invalid", actorName: "Synthetic backfill operator", route: "/synthetic/token-backfill", method: "POST" });
const run = <T>(work: () => Promise<T>) => activityContext.run(actor(), work);
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic snapshot barrier deadline")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
const safeFailure = (error: unknown) => {
  for (const secret of ["synthetic-fallback-token", "malformed-private-value", "synthetic-backfill@example.invalid"]) assert.ok(!String(error).includes(secret));
  return true;
};

test("token backfill repository on an isolated Mongo replica set", { skip: !uri, timeout: 240_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_token_backfill_${randomBytes(8).toString("hex")}`;
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture(data = coachTokenBackfillFixtures()) {
    const options = { client, databaseName, namespace: `shadow_backfill_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoCoachTokenBackfillStore(options);
    const store = new MongoOperationStore(options, COACH_TOKEN_BACKFILL_MODELS);
    for (const [model, rows] of data) if (rows.length) await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    const repo = await MongoCoachTokenBackfillRepository.open(options);
    const snapshot = async () => Object.fromEntries(await Promise.all(COACH_TOKEN_BACKFILL_MODELS.map(async model => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()])));
    const insert = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, values);
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
    };
    const replace = async (model: string, id: string, values: MongoRow) => {
      const row = await store.one(model, { _id: id }); assert.ok(row);
      await store.collection(model).replaceOne({ _id: id }, encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...row, ...values })));
    };
    return { options, store, repo, snapshot, insert, replace };
  }
  // Retain command metadata only, never token/document payloads.
  async function wire<T>(namespace: string, work: () => Promise<T>) {
    const commands: string[] = [], pages: Array<{ collection: string; count: number; bytes: number; limit: number; singleBatch: boolean }> = [];
    const pending = new Map<number, { collection: string; limit: number; singleBatch: boolean }>();
    const sessions = new Set<string>();
    const start = (event: CommandStartedEvent) => {
      const sessionId = event.command.lsid?.id?.toString();
      if (event.databaseName === databaseName && sessionId) sessions.add(sessionId);
      const ownTransaction = event.databaseName === "admin" && ["commitTransaction", "abortTransaction"].includes(event.commandName) && sessions.has(sessionId);
      if (event.databaseName !== databaseName && !ownTransaction) return;
      commands.push(event.commandName);
      if (event.commandName === "aggregate" && String(event.command.aggregate).startsWith(namespace)) {
        const pipeline = event.command.pipeline as Array<{ $limit?: number }>;
        pending.set(event.requestId, { collection: String(event.command.aggregate), limit: Number(pipeline.at(-1)?.$limit ?? 0), singleBatch: false });
      }
    };
    const done = (event: CommandSucceededEvent) => {
      const info = pending.get(event.requestId); if (!info) return;
      pending.delete(event.requestId);
      const reply = event.reply as { cursor: { firstBatch: unknown[] } };
      pages.push({ ...info, count: reply.cursor.firstBatch.length, bytes: BSON.calculateObjectSize(reply) });
    };
    client.on("commandStarted", start); client.on("commandSucceeded", done);
    try { return { result: await work(), commands, pages }; }
    finally { client.off("commandStarted", start); client.off("commandSucceeded", done); }
  }
  try {
    await client.connect(); connected = true;
    await suite.test("fixed dry-run counts preserve latest nonnull/empty/scalar/array/status/schema/table/id tie rules with zero writes", async () => {
      const f = await fixture(), before = await f.snapshot();
      const collections = await f.store.db.listCollections({}, { nameOnly: true }).toArray();
      const observed = await wire(f.options.namespace, () => run(() => f.repo.backfill({ apply: false })));
      assert.deepEqual(observed.result, expectedTokenBackfillDryRun);
      assert.deepEqual(await f.snapshot(), before);
      assert.deepEqual(await f.store.db.listCollections({}, { nameOnly: true }).toArray(), collections);
      assert.ok(observed.commands.every(command => ["find", "aggregate", "getMore", "killCursors", "commitTransaction", "abortTransaction"].includes(command)), observed.commands.join(","));
      assert.ok(!observed.commands.includes("getMore"));
    });

    await suite.test("apply writes only changed encrypted tokens and redacted audits; rerun preserves every stored byte and updatedAt", async () => {
      const f = await fixture(), before = await f.snapshot();
      assert.deepEqual(await run(() => f.repo.backfill({ apply: true })), expectedTokenBackfillApply);
      for (const [id, token] of Object.entries(expectedBackfilledTokens)) {
        const logical = await f.store.one("Coach", { _id: id }); assert.ok(logical); assert.equal(logical.accessToken, token);
        const raw = await f.store.collection("Coach").findOne({ _id: id }); assert.ok(raw);
        const previous = before.Coach.find((row: MongoRow) => row._id === id); assert.ok(previous);
        const unchangedFields = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row)
          .filter(([field]) => !["accessToken", "accessTokenPiiIndex", "updatedAt"].includes(field)));
        assert.deepEqual(unchangedFields(raw), unchangedFields(previous), "even changed coaches retain all unrelated raw fields/ciphertext");
        assert.equal(raw.accessTokenPiiIndex, mongoRuntimeBlindIndex("Coach", "accessToken", token));
        if (token !== null) assert.ok(isEncrypted(raw.accessToken));
        if ([ids.same, ids.none, ids.caseSource, ids.paddedSource].includes(id)) {
          assert.deepEqual(raw, before.Coach.find((row: MongoRow) => row._id === id));
          assert.deepEqual(logical.updatedAt, TOKEN_BACKFILL_UPDATED_AT);
        } else assert.notDeepEqual(logical.updatedAt, TOKEN_BACKFILL_UPDATED_AT);
      }
      const audits = await f.store.scan("ActivityChange", {});
      assert.equal(audits.length, 9);
      assert.ok(audits.every(row => row.targetType === "coaches" && row.action === "update"));
      for (const row of audits) assert.deepEqual(row.changes, { access_token: { redacted: true } });
      const rawAudit = JSON.stringify(await f.store.collection("ActivityChange").find({}).toArray());
      assert.ok(!rawAudit.includes("synthetic-fallback-token") && !rawAudit.includes("synthetic-backfill@example.invalid"));
      const applied = await f.snapshot();
      assert.deepEqual(await run(() => f.repo.backfill({ apply: true })), expectedTokenBackfillRerun);
      assert.deepEqual(await f.snapshot(), applied);
    });

    await suite.test("scoped CLI service applies and reapplies real Mongo without env access or activity audit; JSON null falls back", async () => {
      const f = await fixture();
      await f.replace("CoachdbArchiveRow", ids.fallbackNullRow, { rowData: MongoJsonNull });
      const command = () => runWithDataRepositories({ coachTokenBackfill: f.repo }, () => runCoachTokenBackfillCommand(
        ["--apply", "--backup-confirmed", "--maintenance-confirmed"], () => { throw new Error("Unexpected env"); },
      ));
      assert.deepEqual(await command(), { options: { apply: true }, summary: expectedTokenBackfillApply });
      const applied = await f.snapshot();
      assert.deepEqual(await command(), { options: { apply: true }, summary: expectedTokenBackfillRerun });
      assert.deepEqual(await f.snapshot(), applied);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0);
    });

    for (const token of [false, 0, { secret: "malformed-private-value" }, ["malformed-private-value"]]) {
      await suite.test(`required non-string ${Array.isArray(token) ? "array" : typeof token} token rejects dry-run and apply without changing data`, async () => {
        const f = await fixture();
        await f.replace("CoachdbArchiveRow", ids.fallbackNullRow, { rowData: { access_token: token } });
        const before = await f.snapshot();
        for (const apply of [false, true]) await assert.rejects(run(() => f.repo.backfill({ apply })), safeFailure);
        assert.deepEqual(await f.snapshot(), before);
      });
    }

    await suite.test("251 coaches and 502 eligible archive rows cross both bounded page boundaries", async () => {
      const data = new Map<string, MongoRow[]>();
      data.set("CoachdbArchiveSnapshot", [coachFixtureRow("CoachdbArchiveSnapshot", { id: ids.oldSnapshot, status: "completed", startedAt: new Date("2097-01-01") }), coachFixtureRow("CoachdbArchiveSnapshot", { id: ids.latestSnapshot, status: "completed", startedAt: new Date("2098-01-01") })]);
      const coaches: MongoRow[] = [], archives: MongoRow[] = [];
      for (let n = 0; n < 251; n++) {
        const id = tokenBackfillId(1000 + n), source = tokenBackfillSource(id);
        coaches.push(coachFixtureRow("Coach", { id, sourceCoachId: source, accessToken: null }));
        for (const [snapshotId, access_token] of [[ids.oldSnapshot, `synthetic-paged-token-${n}`], [ids.latestSnapshot, null]] as const) archives.push(coachFixtureRow("CoachdbArchiveRow", { snapshotId, tableSchema: "public", tableName: "coaches", rowKey: source, rowData: { access_token } }));
      }
      data.set("Coach", coaches); data.set("CoachdbArchiveRow", archives);
      const f = await fixture(data), before = await f.snapshot();
      const original = Collection.prototype.insertOne;
      let auditInserts = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++auditInserts === 251) throw new Error("Synthetic second-page audit failure");
        return result;
      });
      try { await assert.rejects(run(() => f.repo.backfill({ apply: true })), safeFailure); }
      finally { patch.mock.restore(); }
      assert.equal(auditInserts, 251, "the complete first page and one second-page write/audit must execute before failure");
      assert.deepEqual(await f.snapshot(), before, "second-page failure rolls back the first 250 writes and audits too");
      const observed = await wire(f.options.namespace, () => f.repo.backfill({ apply: true }));
      assert.deepEqual(observed.result, { archivedTokens: 251, missingTokens: 251, changedTokens: 251, updatedTokens: 251 });
      for (let n = 0; n < 251; n++) assert.equal((await f.store.one("Coach", { _id: tokenBackfillId(1000 + n) }))?.accessToken, `synthetic-paged-token-${n}`);
      assert.ok(!observed.commands.includes("getMore"));
      for (const model of ["Coach", "CoachdbArchiveRow"]) {
        const pages = observed.pages.filter(page => page.collection === `${f.options.namespace}_${model}`);
        assert.ok(pages.length > 1, `${model} must read multiple pages`);
        if (model === "Coach") assert.ok(pages.some(page => page.count === 0), "nonempty scan reaches a real empty EOF page");
        assert.ok(pages.every(page => page.limit > 0 && page.limit <= 250 && page.count <= 250));
      }
    });

    await suite.test("unique-token violation rolls back all earlier updates and audits", async () => {
      const f = await fixture();
      const archive = await f.store.one("CoachdbArchiveRow", { rowKeyPiiIndex: mongoRuntimeBlindIndex("CoachdbArchiveRow", "rowKey", tokenBackfillSource(ids.inactive)) }); assert.ok(archive);
      await f.replace("CoachdbArchiveRow", archive.id as string, { rowData: { access_token: "synthetic-same-token" } });
      const before = await f.snapshot();
      assert.deepEqual(await f.repo.backfill({ apply: false }), expectedTokenBackfillDryRun);
      assert.deepEqual(await f.snapshot(), before);
      await assert.rejects(run(() => f.repo.backfill({ apply: true })), safeFailure);
      assert.deepEqual(await f.snapshot(), before);
    });

    await suite.test("a second real audit insert failure rolls back the complete job", async () => {
      const f = await fixture(), before = await f.snapshot(), original = Collection.prototype.insertOne;
      let audits = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++audits === 2) throw new Error("malformed-private-value");
        return result;
      });
      try { await assert.rejects(run(() => f.repo.backfill({ apply: true })), safeFailure); }
      finally { patch.mock.restore(); }
      assert.equal(audits, 2); assert.deepEqual(await f.snapshot(), before);
    });

    await suite.test("transient late audit failure retries the whole transaction exactly once", async () => {
      const f = await fixture(), original = Collection.prototype.insertOne;
      let audits = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++audits === 2) {
          const error = new MongoServerError({ message: "Synthetic transient conflict", code: 112 });
          error.addErrorLabel("TransientTransactionError"); throw error;
        }
        return result;
      });
      try {
        const observed = await wire(f.options.namespace, () => run(() => f.repo.backfill({ apply: true })));
        assert.deepEqual(observed.result, expectedTokenBackfillApply);
        assert.ok(observed.commands.includes("abortTransaction"));
        assert.equal(observed.commands.filter(command => command === "commitTransaction").length, 1);
      } finally { patch.mock.restore(); }
      assert.equal(audits, 11);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 9);
      for (const [id, token] of Object.entries(expectedBackfilledTokens)) assert.equal((await f.store.one("Coach", { _id: id }))?.accessToken, token);
    });

    await suite.test("simulated 120-second deadline after real writes rejects and rolls back (no wall-clock duration claim)", async () => {
      const f = await fixture(), before = await f.snapshot(), original = Collection.prototype.insertOne;
      const now = performance.now.bind(performance);
      let elapsed = 0, audits = 0;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange` && ++audits === 2) elapsed = 120_001;
        return result;
      });
      try { await assert.rejects(run(() => f.repo.backfill({ apply: true })), safeFailure); }
      finally { patch.mock.restore(); clock.mock.restore(); }
      assert.equal(audits, 2); assert.deepEqual(await f.snapshot(), before);
    });

    await suite.test("retry keeps the original deadline: simulated 80s then 50s rejects with complete rollback", async () => {
      const f = await fixture(), before = await f.snapshot(), original = Collection.prototype.insertOne;
      const now = performance.now.bind(performance);
      let elapsed = 0, audits = 0;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_ActivityChange`) {
          audits++;
          if (audits === 2) {
            elapsed = 80_000;
            const error = new MongoServerError({ message: "Synthetic transient conflict", code: 112 });
            error.addErrorLabel("TransientTransactionError"); throw error;
          }
          // Third successful insert is the first write/audit of the retried transaction.
          if (audits === 3) elapsed += 50_000;
        }
        return result;
      });
      try {
        const observed = await wire(f.options.namespace, async () => {
          await assert.rejects(run(() => f.repo.backfill({ apply: true })), error => {
            assert.ok(error instanceof MongoOperationError);
            assert.equal(error.code, "COACH_TOKEN_BACKFILL_TIMEOUT"); return true;
          });
        });
        assert.equal(observed.commands.filter(command => command === "abortTransaction").length, 2);
        assert.ok(!observed.commands.includes("commitTransaction"));
      } finally { patch.mock.restore(); clock.mock.restore(); }
      assert.equal(audits, 3); assert.equal(elapsed, 130_000);
      assert.deepEqual(await f.snapshot(), before);
    });

    await suite.test("empty aggregate firstBatch at EOF never issues getMore", async () => {
      const f = await fixture(new Map());
      const observed = await wire(f.options.namespace, () => f.repo.backfill({ apply: false }));
      assert.deepEqual(observed.result, { archivedTokens: 0, missingTokens: 0, changedTokens: 0, updatedTokens: 0 });
      assert.equal(observed.pages.length, 1); assert.equal(observed.pages[0].count, 0);
      assert.ok(!observed.commands.includes("getMore"));
    });

    for (const corruption of ["encryption-key", "index-key", "row-key-index", "row-data-ciphertext"] as const) {
      await suite.test(`${corruption} mismatch fails closed and never partially applies`, async () => {
        const f = await fixture(), before = await f.snapshot();
        const keys = process.env.PII_ENCRYPTION_KEYS!, indexKey = process.env.PII_INDEX_KEY!;
        if (corruption === "encryption-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
        if (corruption === "index-key") process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
        if (corruption === "row-key-index") {
          // Forge an unrelated archive into the selected rowKey bucket; authenticate the original text too.
          const row = await f.store.collection("CoachdbArchiveRow").findOne({ _id: ids.fallbackOldRow }); assert.ok(row);
          await f.insert("CoachdbArchiveRow", { snapshotId: ids.tieHighSnapshot, tableSchema: "public", tableName: "coaches", rowKey: "unrelated-source", rowData: { access_token: "malformed-private-value" } });
          await f.store.collection("CoachdbArchiveRow").updateOne({ rowKeyPiiIndex: mongoRuntimeBlindIndex("CoachdbArchiveRow", "rowKey", "unrelated-source") }, { $set: { rowKeyPiiIndex: row.rowKeyPiiIndex } });
        }
        if (corruption === "row-data-ciphertext") {
          const row = await f.store.collection("CoachdbArchiveRow").findOne({ _id: ids.fallbackOldRow }); assert.ok(row);
          const encrypted = row.rowData as { $json: { __pii: string } }; const parts = encrypted.$json.__pii.split(":"); parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
          await f.store.collection("CoachdbArchiveRow").updateOne({ _id: row._id }, { $set: { rowData: { $json: { __pii: parts.join(":") } } } });
        }
        try {
          for (const apply of [false, true]) await assert.rejects(run(() => f.repo.backfill({ apply })), safeFailure);
          assert.deepEqual((await f.snapshot()).Coach, before.Coach);
          assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0);
        } finally { process.env.PII_ENCRYPTION_KEYS = keys; process.env.PII_INDEX_KEY = indexKey; }
      });
    }

    await suite.test("one snapshot survives a newer archive value committed after the first coach page", async () => {
      const f = await fixture(), held = signal(), release = signal(), original = AbstractCursor.prototype.close;
      let paused = false;
      const patch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) {
        await original.apply(this, args);
        if (this.namespace.collection === `${f.options.namespace}_Coach` && !paused) { paused = true; held.resolve(); await release.promise; }
      });
      const pending = f.repo.backfill({ apply: false }); void pending.catch(() => {});
      try {
        await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Snapshot barrier was not reached"); })]));
        const row = await f.store.one("CoachdbArchiveRow", { rowKeyPiiIndex: mongoRuntimeBlindIndex("CoachdbArchiveRow", "rowKey", tokenBackfillSource(ids.same)) }); assert.ok(row);
        await f.replace("CoachdbArchiveRow", row.id as string, { rowData: { access_token: "synthetic-concurrent-new-token" } });
        release.resolve(); assert.deepEqual(await pending, expectedTokenBackfillDryRun);
      } finally { release.resolve(); await Promise.allSettled([pending]); patch.mock.restore(); }
      assert.deepEqual(await f.repo.backfill({ apply: false }), { ...expectedTokenBackfillDryRun, changedTokens: 10 });
    });

    for (const largeModel of ["Coach", "CoachdbArchiveRow"] as const) {
      await suite.test(`BSON-short ${largeModel} first batch continues without getMore or omitted tokens`, async () => {
        const f = await fixture(new Map());
        await f.insert("CoachdbArchiveSnapshot", { id: ids.latestSnapshot, status: "completed", startedAt: new Date("2099-01-01") });
        for (let n = 0; n < 3; n++) {
          const id = tokenBackfillId(2000 + n), source = tokenBackfillSource(id);
          await f.insert("Coach", { id, sourceCoachId: source, accessToken: null, ...(largeModel === "Coach" ? { managerNote: "x".repeat(5 * 1024 * 1024) } : {}) });
          await f.insert("CoachdbArchiveRow", { snapshotId: ids.latestSnapshot, tableSchema: "public", tableName: "coaches", rowKey: source, rowData: { access_token: `synthetic-large-token-${n}`, ...(largeModel === "CoachdbArchiveRow" ? { padding: "x".repeat(5 * 1024 * 1024) } : {}) } });
        }
        const observed = await wire(f.options.namespace, () => f.repo.backfill({ apply: true }));
        assert.deepEqual(observed.result, { archivedTokens: 3, missingTokens: 3, changedTokens: 3, updatedTokens: 3 });
        assert.ok(!observed.commands.includes("getMore"));
        const pages = observed.pages.filter(page => page.collection === `${f.options.namespace}_${largeModel}`);
        assert.ok(pages.some(page => page.count > 0 && page.count < 3 && page.bytes > 6 * 1024 * 1024), "a real BSON-short page must occur");
        assert.ok(pages.filter(page => page.count > 0).length >= 2);
      });
    }

    for (const problem of ["validator", "index"] as const) {
      await suite.test(`unready ${problem} rejects open without automatic DDL`, async () => {
        const f = await fixture(), collection = f.store.collection("CoachdbArchiveRow");
        if (problem === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "moderate" });
        else { const name = operationMongoIndexes("CoachdbArchiveRow")[0]?.name; assert.ok(name); await collection.dropIndex(name); }
        const observed = await wire(f.options.namespace, async () => { await assert.rejects(MongoCoachTokenBackfillRepository.open(f.options)); });
        assert.ok(observed.commands.every(command => ["hello", "listCollections", "listIndexes", "getMore", "killCursors"].includes(command)));
      });
    }
  } finally {
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_token_backfill_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
