import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { AbstractCursor, Collection, MongoClient, MongoServerError, type CommandStartedEvent, type CommandSucceededEvent } from "mongodb";
import { MongoCoachContentRepository, prepareMongoCoachContentStore } from "./mongoCoachContentRepository";
import { COACH_ADMIN_MODELS, MongoCoachAdminRepository, prepareMongoCoachAdminStore } from "./mongoCoachAdminRepository";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoOperationStore, operationMongoIndexes, type MongoRow } from "./mongoOperationStore";
import { activityContext } from "../activity/context";
import { isEncrypted } from "../privacy/crypto";

// Explicit, local-only opt-in: never fall back to application/production URI variables.
const uri = process.env.MONGODB_COACH_CONTENT_TEST_URI;
const author = { email: "synthetic-content@example.invalid", name: "가상 메모 작성자" };
const editor = { email: "synthetic-editor@example.invalid", name: "가상 메모 수정자" };
const privateContent = "가상 비공개 상담 메모 연락처 synthetic-note@example.invalid";
const actions = ["create", "update", "delete", "toggle"] as const;
type Action = typeof actions[number];
const hasCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;
function noCompanions(value: unknown): void {
  if (!value || typeof value !== "object" || value instanceof Date) return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!/PiiIndex$|Encrypted$|^_id$/.test(key), `storage field leaked: ${key}`);
    noCompanions(child);
  }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

test("coach content repository on an isolated Mongo replica set", { skip: !uri, timeout: 240_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, "");
  assert.ok(url.pathname === "" || url.pathname === "/");
  // directConnection prevents replica-set discovery from contacting external members.
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const databaseName = `hub_om_shadow_coach_content_${randomBytes(8).toString("hex")}`;
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "fixture";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  let connected = false;
  async function checkPagedFind<T>(collections: string[], work: () => Promise<T>, minimumFinds = 2, shortBsonPage = false): Promise<T> {
    const finds: Array<{ collection: string; singleBatch: unknown; limit: number }> = [];
    const requestCollections = new Map<number, string>();
    const batches: number[] = [];
    let getMoreCount = 0;
    const started = (event: CommandStartedEvent) => {
      if (event.databaseName !== databaseName) return;
      if (event.commandName === "getMore" && collections.includes(event.command.collection)) getMoreCount++;
      if (event.commandName === "find" && collections.includes(event.command.find)) {
        finds.push({ collection: event.command.find, singleBatch: event.command.singleBatch, limit: event.command.limit });
        requestCollections.set(event.requestId, event.command.find);
      }
    };
    const succeeded = (event: CommandSucceededEvent) => {
      if (requestCollections.has(event.requestId) && event.commandName === "find") batches.push((event.reply as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch.length);
    };
    client.on("commandStarted", started); client.on("commandSucceeded", succeeded);
    try {
      const result = await work();
      assert.equal(getMoreCount, 0, "keyset reads must never issue getMore");
      for (const collection of collections) assert.ok(finds.filter(command => command.collection === collection).length >= minimumFinds, `${collection}: multiple find pages must execute`);
      assert.ok(finds.every(command => command.singleBatch === true && command.limit > 0 && command.limit <= 100));
      if (shortBsonPage) {
        assert.ok(batches[0] > 0 && batches[0] < 3, "BSON response limit must split the three large rows before the requested 100 rows");
        assert.ok(batches.slice(1).some(count => count > 0), "a short nonempty page must not be mistaken for EOF");
        assert.equal(batches.at(-1), 0, "only an empty page proves EOF below the feed cap");
      }
      return result;
    } finally { client.off("commandStarted", started); client.off("commandSucceeded", succeeded); }
  }
  async function fixture(deleted = false) {
    const options = { client, databaseName, namespace: `shadow_content_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoCoachAdminStore(options);
    await prepareMongoCoachContentStore(options);
    const store = new MongoOperationStore(options, COACH_ADMIN_MODELS);
    const coachId = randomUUID(), otherCoachId = randomUUID();
    for (const id of [coachId, otherCoachId]) {
      const row = coachFixtureRow("Coach", { id, name: `가상 코치 ${id}`, normalizedName: `가상코치${id}`, status: "ACTIVE", deletedAt: deleted && id === coachId ? new Date("2099-01-01") : null });
      await store.collection("Coach").insertOne(encodeMongoRuntimeDocument("Coach", row));
    }
    const repo = await MongoCoachContentRepository.open(options);
    const admin = await MongoCoachAdminRepository.open(options);
    const run = <T>(work: () => Promise<T>, requestId: string = randomUUID()) => activityContext.run({
      requestId, route: "/synthetic/coach-content", method: "POST", actorType: "user", actorEmail: author.email, actorName: author.name
    }, work);
    const seed = async (values: MongoRow = {}) => {
      const row = coachFixtureRow("CoachContentEntry", { coachId, kind: "NOTE", content: privateContent, authorEmail: author.email, authorName: author.name, ...values });
      await store.collection("CoachContentEntry").insertOne(encodeMongoRuntimeDocument("CoachContentEntry", row));
      return row.id as string;
    };
    const mutate = (action: Action, noteId: string) => run(() => action === "create" ? repo.createNote(coachId, privateContent, author)
      : action === "update" ? repo.updateNote(coachId, noteId, `${privateContent} 수정`, editor)
      : action === "delete" ? repo.deleteNote(coachId, noteId, editor) : repo.toggleNoteWarning(coachId, noteId, editor));
    const snapshot = async () => ({
      notes: await store.collection("CoachContentEntry").find({}).sort({ _id: 1 }).toArray(),
      audits: await store.collection("ActivityChange").find({}).sort({ _id: 1 }).toArray()
    });
    return { options, store, coachId, otherCoachId, repo, admin, run, seed, mutate, snapshot };
  }
  try {
    await client.connect(); connected = true;
    for (const unready of ["guard", "validator", "index"] as const) {
      await suite.test(`open rejects unready ${unready} without DDL repair or business changes`, async () => {
        const f = await fixture();
        await f.seed();
        const collection = f.store.collection("CoachContentEntry");
        if (unready === "guard") await f.store.db.collection(`${f.options.namespace}_CoachSchedulingGuard`).drop();
        if (unready === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "moderate" });
        if (unready === "index") {
          const name = operationMongoIndexes("CoachContentEntry")[0]?.name;
          assert.ok(name, "fixture must have a required content index");
          await collection.dropIndex(name);
        }
        const metadata = async () => {
          const collections = (await f.store.db.listCollections({}, { nameOnly: false }).toArray())
            .filter(row => row.name.startsWith(`${f.options.namespace}_`)).sort((a, b) => a.name.localeCompare(b.name));
          return Promise.all(collections.map(async row => ({ name: row.name, options: row.options,
            indexes: (await f.store.db.collection(row.name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name)))
          })));
        };
        const before = await metadata(), data = await f.snapshot(), commands: string[] = [];
        const listener = (event: CommandStartedEvent) => { commands.push(event.commandName); };
        client.on("commandStarted", listener);
        try {
          await assert.rejects(MongoCoachContentRepository.open(f.options), hasCode(unready === "guard" ? "COACH_SCHEDULING_GUARD_NOT_READY" : unready === "validator" ? "VALIDATOR_NOT_READY" : "INDEX_NOT_READY"));
        } finally { client.off("commandStarted", listener); }
        assert.ok(commands.length > 0);
        assert.ok(commands.every(command => ["hello", "listCollections", "listIndexes", "getMore", "killCursors"].includes(command)), `open issued a non-readiness command: ${commands.join(",")}`);
        assert.deepEqual(await metadata(), before, "open must not recreate guards, repair validators or build indexes");
        assert.deepEqual(await f.snapshot(), data);
      });
    }

    await suite.test("note CRUD appends exact EDIT_HISTORY, audits once per mutation and exposes only logical fields", async () => {
      const f = await fixture();
      assert.deepEqual(await f.repo.listNotes(f.coachId), []);
      const text = `  ${"가".repeat(41)}  `;
      const note = await f.run(() => f.repo.createNote(f.coachId.toUpperCase(), text, author));
      assert.equal(note.content, text); assert.equal(note.kind, "NOTE"); assert.equal(note.coachId, f.coachId);
      assert.equal(note.deletedAt, null); assert.equal(note.flaggedAt, null);
      assert.ok(note.createdAt instanceof Date && note.updatedAt instanceof Date);
      assert.deepEqual(Object.keys(note).sort(), ["id", "coachId", "kind", "content", "authorEmail", "authorName", "sourceField", "flaggedAt", "createdAt", "updatedAt", "deletedAt"].sort());
      const updated = await f.run(() => f.repo.updateNote(f.coachId.toUpperCase(), note.id.toUpperCase(), privateContent, editor));
      assert.equal(updated.content, privateContent); assert.equal(updated.authorEmail, author.email); assert.equal(updated.authorName, author.name);
      assert.deepEqual(updated.createdAt, note.createdAt);
      const flagged = await f.run(() => f.repo.toggleNoteWarning(f.coachId, note.id, editor));
      assert.ok(flagged.flaggedAt instanceof Date);
      const cleared = await f.run(() => f.repo.toggleNoteWarning(f.coachId, note.id, editor));
      assert.equal(cleared.flaggedAt, null);
      const listed = await f.repo.listNotes(f.coachId.toUpperCase());
      assert.deepEqual(listed, [{ id: note.id, content: privateContent, authorName: author.name, flaggedAt: null, createdAt: note.createdAt }]);
      const deleted = await f.run(() => f.repo.deleteNote(f.coachId, note.id, editor));
      assert.ok(deleted.deletedAt instanceof Date);
      assert.deepEqual(await f.repo.listNotes(f.coachId), []);
      assert.equal(await f.store.collection("CoachContentEntry").countDocuments({ _id: note.id }), 1);
      const histories = await f.store.scan("CoachContentEntry", { kind: "EDIT_HISTORY" });
      const brief = privateContent.trim().length > 40 ? `${privateContent.trim().slice(0, 40)}…` : privateContent.trim();
      assert.deepEqual(histories.map(row => row.content).sort(), [
        `메모 작성: ${"가".repeat(40)}…`, `메모 수정: ${brief}`, `메모 경고 설정: ${brief}`, `메모 경고 해제: ${brief}`, `메모 삭제: ${brief}`
      ].sort());
      assert.ok(histories.every(row => row.coachId === f.coachId && row.sourceField === "coach_content_entries.note"));
      assert.equal(histories.filter(row => row.authorEmail === editor.email && row.authorName === editor.name).length, 4);
      const audit = await f.store.scan("ActivityChange", {});
      assert.equal(audit.length, 5);
      assert.ok(audit.every(row => row.targetId === note.id && row.targetType === "coach_content_entries"));
      assert.deepEqual(audit.map(row => row.action).sort(), ["create", "delete", "update", "update", "update"]);
      assert.ok(!audit.some(row => histories.some(history => history.id === row.targetId)), "EDIT_HISTORY must not recursively generate audits");
      noCompanions([note, updated, flagged, cleared, deleted, listed]);
    });

    await suite.test("stored notes, history and audit actor fields are encrypted; audit changes redact private values", async () => {
      const f = await fixture();
      const note = await f.run(() => f.repo.createNote(f.coachId, privateContent, author));
      await f.run(() => f.repo.updateNote(f.coachId, note.id, `${privateContent} 변경`, editor));
      const rawNotes = await f.store.collection("CoachContentEntry").find({}).toArray();
      assert.equal(rawNotes.length, 3);
      for (const row of rawNotes) for (const field of ["content", "authorEmail", "authorName"]) assert.ok(isEncrypted(row[field]), field);
      const rawAudits = await f.store.collection("ActivityChange").find({}).toArray();
      assert.equal(rawAudits.length, 2);
      for (const row of rawAudits) for (const field of ["actorEmail", "actorName"]) assert.ok(isEncrypted(row[field]), field);
      const raw = JSON.stringify([rawNotes, rawAudits]);
      for (const secret of [privateContent, author.email, author.name, editor.email, editor.name]) assert.ok(!raw.includes(secret));
      for (const row of await f.store.scan("ActivityChange", {})) {
        const changes = row.changes as Record<string, unknown>;
        assert.deepEqual(changes.content, { redacted: true });
        assert.ok(!JSON.stringify(changes).includes(privateContent));
        noCompanions(changes);
      }
      const feed = await f.repo.getContentFeed();
      assert.equal(feed.entries[0].content, `${privateContent} 변경`);
      assert.equal(feed.entries[0].coach.id, f.coachId);
      noCompanions([await f.repo.listNotes(f.coachId), feed, await f.repo.getScheduleRegistration("2099-01"), await f.repo.getScheduleStatus("2099-01")]);
    });

    await suite.test("list filters deleted/history/other coaches and sorts newest first", async () => {
      const f = await fixture();
      const older = await f.seed({ createdAt: new Date("2099-01-01") });
      const newer = await f.seed({ createdAt: new Date("2099-01-03") });
      await f.seed({ createdAt: new Date("2099-01-04"), deletedAt: new Date("2099-01-05") });
      await f.seed({ createdAt: new Date("2099-01-06"), kind: "EDIT_HISTORY" });
      await f.seed({ coachId: f.otherCoachId, createdAt: new Date("2099-01-07") });
      assert.deepEqual((await f.repo.listNotes(f.coachId)).map(row => row.id), [newer, older]);
    });

    await suite.test("missing coach, missing row and wrong coach reject without notes, history or audit writes", async () => {
      const f = await fixture(), noteId = await f.seed(), before = await f.snapshot();
      const missing = randomUUID();
      await assert.rejects(f.run(() => f.repo.createNote(missing, privateContent, author)), hasCode("COACH_NOT_FOUND"));
      for (const coachId of [missing, f.otherCoachId, f.coachId]) {
        const target = coachId === f.coachId ? randomUUID() : noteId;
        const code = coachId === missing ? "COACH_NOT_FOUND" : "COACH_CONTENT_NOT_FOUND";
        await assert.rejects(f.run(() => f.repo.updateNote(coachId, target, "changed", editor)), hasCode(code));
        await assert.rejects(f.run(() => f.repo.deleteNote(coachId, target, editor)), hasCode(code));
        await assert.rejects(f.run(() => f.repo.toggleNoteWarning(coachId, target, editor)), hasCode(code));
      }
      assert.deepEqual(await f.snapshot(), before);
    });

    await suite.test("writes preserve id+coach lookup even for deleted coaches, deleted notes and EDIT_HISTORY targets", async () => {
      const f = await fixture(true);
      const deletedAt = new Date("2099-01-02");
      const id = await f.seed({ deletedAt });
      const updated = await f.run(() => f.repo.updateNote(f.coachId, id, "삭제된 메모 수정", editor));
      assert.deepEqual(updated.deletedAt, deletedAt);
      assert.ok((await f.run(() => f.repo.toggleNoteWarning(f.coachId, id, editor))).flaggedAt instanceof Date);
      assert.ok((await f.run(() => f.repo.deleteNote(f.coachId, id, editor))).deletedAt instanceof Date);
      assert.deepEqual(await f.repo.listNotes(f.coachId), []);
      const historyId = await f.seed({ kind: "EDIT_HISTORY" });
      const beforeAudit = await f.store.collection("ActivityChange").countDocuments();
      assert.equal((await f.run(() => f.repo.updateNote(f.coachId, historyId, "이력 수정", editor))).kind, "EDIT_HISTORY");
      assert.ok((await f.run(() => f.repo.toggleNoteWarning(f.coachId, historyId, editor))).flaggedAt instanceof Date);
      await f.run(() => f.repo.deleteNote(f.coachId, historyId, editor));
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), beforeAudit, "history targets still skip audit");
      const created = await f.run(() => f.repo.createNote(f.coachId, "삭제 코치 메모", author));
      assert.deepEqual((await f.repo.listNotes(f.coachId)).map(row => row.id), [created.id]);
      assert.equal(await f.store.collection("CoachContentEntry").countDocuments({ kind: "EDIT_HISTORY" }), 8);
    });

    await suite.test("content feed independently limits notes and reviews to the latest 300 without coach/status filtering", async () => {
      const f = await fixture(true);
      const base = Date.parse("2099-02-01T00:00:00.000Z");
      const notes = [], reviews = [];
      for (let i = 0; i < 301; i++) {
        const createdAt = new Date(base + Math.floor(i / 101) * 1000);
        notes.push(coachFixtureRow("CoachContentEntry", { coachId: f.coachId, kind: "NOTE", content: `가상 피드 메모 ${i}`, createdAt }));
        reviews.push(coachFixtureRow("CoachEngagement", { coachId: f.coachId, courseName: `가상 과정 ${i}`, status: "CANCELLED", rating: i % 2 ? null : 0, feedback: i % 2 ? "" : null, createdAt }));
      }
      await f.store.collection("CoachContentEntry").insertMany(notes.map(row => encodeMongoRuntimeDocument("CoachContentEntry", row)));
      await f.store.collection("CoachEngagement").insertMany(reviews.map(row => encodeMongoRuntimeDocument("CoachEngagement", row)));
      await f.seed({ kind: "EDIT_HISTORY", createdAt: new Date(base + 999_000) });
      await f.seed({ deletedAt: new Date(base), createdAt: new Date(base + 999_000) });
      await f.store.collection("CoachEngagement").insertOne(encodeMongoRuntimeDocument("CoachEngagement", coachFixtureRow("CoachEngagement", {
        coachId: f.coachId, rating: null, feedback: null, createdAt: new Date(base + 999_000)
      })));
      const feed = await checkPagedFind(["CoachContentEntry", "CoachEngagement"].map(model => `${f.options.namespace}_${model}`), () => f.repo.getContentFeed(), 3);
      const latest = (rows: MongoRow[]) => rows.slice().sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || (a.id as string).localeCompare(b.id as string)).slice(0, 300).map(row => row.id);
      assert.equal(feed.entries.length, 300); assert.equal(feed.reviewedEngagements.length, 300);
      assert.deepEqual(feed.entries.map(row => row.id), latest(notes));
      assert.deepEqual(feed.reviewedEngagements.map(row => row.id), latest(reviews));
      assert.ok(feed.entries.every(row => row.coach.id === f.coachId));
      assert.ok(feed.reviewedEngagements.every(row => row.coach.id === f.coachId));
      assert.ok(feed.reviewedEngagements.some(row => row.feedback === "" && row.rating === null));
      assert.ok(feed.reviewedEngagements.some(row => row.rating === 0 && row.feedback === null));
      assert.deepEqual(Object.keys(feed.entries[0]).sort(), ["id", "kind", "content", "authorName", "sourceField", "flaggedAt", "createdAt", "coach"].sort());
      assert.deepEqual(Object.keys(feed.reviewedEngagements[0]).sort(), ["id", "rating", "feedback", "courseName", "createdAt", "reviewFlaggedAt", "coach"].sort());
      noCompanions(feed);
    });

    for (const reader of ["listNotes", "store.scan"] as const) {
      await suite.test(`301 notes survive ${reader} keyset pages without getMore`, async () => {
        const f = await fixture();
        const rows = Array.from({ length: 301 }, (_, i) => coachFixtureRow("CoachContentEntry", {
          coachId: f.coachId, kind: "NOTE", content: `가상 다중 배치 ${i}`, createdAt: new Date(Date.parse("2099-04-01") + i * 1000)
        }));
        const collection = f.store.collection("CoachContentEntry");
        await collection.insertMany(rows.map(row => encodeMongoRuntimeDocument("CoachContentEntry", row)));
        // Direct scan covers no-session CSOT; listNotes covers a repository transaction.
        if (reader === "listNotes") {
          const listed = await checkPagedFind([collection.collectionName], () => f.repo.listNotes(f.coachId), 5);
          assert.deepEqual(listed.map(row => row.id), rows.slice().reverse().map(row => row.id));
          noCompanions(listed);
        } else {
          const scanned = await checkPagedFind([collection.collectionName], () => f.store.scan("CoachContentEntry", { coachId: f.coachId }), 5);
          assert.equal(scanned.length, 301);
          assert.deepEqual(scanned.map(row => row.id).sort(), rows.map(row => row.id).sort());
        }
      });
    }

    await suite.test("BSON-short pages continue until empty for feed, listNotes and direct scan", async () => {
      const f = await fixture();
      // Ciphertext grows these three 5 MiB notes beyond a single 16 MiB response,
      // while their total remains below the repository's 32 MiB scan budget.
      const rows = Array.from({ length: 3 }, (_, i) => coachFixtureRow("CoachContentEntry", {
        coachId: f.coachId, kind: "NOTE", content: `${i}:` + "x".repeat(5 * 1024 * 1024), createdAt: new Date(Date.parse("2099-05-01") + i * 1000)
      }));
      const collection = f.store.collection("CoachContentEntry");
      await collection.insertMany(rows.map(row => encodeMongoRuntimeDocument("CoachContentEntry", row)));
      const feed = await checkPagedFind([collection.collectionName], () => f.repo.getContentFeed(), 3, true);
      assert.deepEqual(feed.entries.map(row => row.id), rows.slice().reverse().map(row => row.id));
      const listed = await checkPagedFind([collection.collectionName], () => f.repo.listNotes(f.coachId), 3, true);
      assert.deepEqual(listed.map(row => row.id), rows.slice().reverse().map(row => row.id));
      const scanned = await checkPagedFind([collection.collectionName], () => f.store.scan("CoachContentEntry", { coachId: f.coachId }), 3, true);
      assert.deepEqual(scanned.map(row => row.id).sort(), rows.map(row => row.id).sort());
      for (const row of scanned) assert.equal((row.content as string).length, 5 * 1024 * 1024 + 2);
    });

    for (const reader of ["store.scan", "listNotes", "feed-empty", "feed-cap"] as const) {
      await suite.test(`final-page deadline rejects late ${reader} success after cursor close`, async () => {
        const f = await fixture();
        const rows = Array.from({ length: reader === "feed-cap" ? 300 : 1 }, (_, i) => coachFixtureRow("CoachContentEntry", {
          coachId: f.coachId, kind: "NOTE", content: `가상 마지막 페이지 ${i}`, createdAt: new Date(Date.parse("2099-06-01") + i * 1000)
        }));
        const collection = f.store.collection("CoachContentEntry");
        await collection.insertMany(rows.map(row => encodeMongoRuntimeDocument("CoachContentEntry", row)));
        const requests = new Set<number>();
        let received = 0, finalPageSeen = false, offset = 0, injections = 0;
        const started = (event: CommandStartedEvent) => {
          if (event.databaseName === databaseName && event.commandName === "find" && event.command.find === collection.collectionName) requests.add(event.requestId);
        };
        const succeeded = (event: CommandSucceededEvent) => {
          if (event.commandName !== "find" || !requests.has(event.requestId)) return;
          const count = (event.reply as { cursor: { firstBatch: unknown[] } }).cursor.firstBatch.length;
          received += count;
          finalPageSeen = reader === "feed-cap" ? received === 300 : count === 0;
        };
        const realNow = performance.now.bind(performance), originalClose = AbstractCursor.prototype.close;
        const clockPatch = mock.method(performance, "now", () => realNow() + offset);
        const closePatch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) {
          await originalClose.apply(this, args);
          if (this.namespace.collection === collection.collectionName && finalPageSeen && injections === 0) {
            // Activate only after the final real page has closed. Sixteen seconds
            // crosses the scan budget but stays inside the 30-second transaction.
            offset = 16_000; injections++;
          }
        });
        client.on("commandStarted", started); client.on("commandSucceeded", succeeded);
        try {
          const work = reader === "store.scan" ? f.store.scan("CoachContentEntry", { coachId: f.coachId })
            : reader === "listNotes" ? f.repo.listNotes(f.coachId) : f.repo.getContentFeed();
          await assert.rejects(work, hasCode("SCAN_TIMEOUT"));
          assert.equal(received, rows.length, "the deadline is crossed only after every target row was fetched");
          assert.ok(finalPageSeen); assert.equal(injections, 1);
        } finally {
          client.off("commandStarted", started); client.off("commandSucceeded", succeeded);
          closePatch.mock.restore(); clockPatch.mock.restore();
        }
      });
    }

    await suite.test("schedule reads retain active/undeleted sorting and exactly-month logs including inactive coach logs", async () => {
      const f = await fixture();
      const inactiveId = randomUUID(), deletedId = randomUUID();
      const coachRows = [
        { id: f.coachId, name: "가상 나", normalizedName: "나", status: "ACTIVE", isActive: true },
        { id: f.otherCoachId, name: "가상 가", normalizedName: "가", status: "ACTIVE", isActive: false },
        { id: inactiveId, name: "가상 비활성", normalizedName: "비활성", status: "INACTIVE", isActive: true },
        { id: deletedId, name: "가상 삭제", normalizedName: "삭제", status: "ACTIVE", isActive: true, deletedAt: new Date("2099-01-01") }
      ];
      for (const row of coachRows) {
        await f.store.collection("Coach").replaceOne({ _id: row.id }, encodeMongoRuntimeDocument("Coach", coachFixtureRow("Coach", {
          ...row, workType: "synthetic-work", accessToken: `synthetic-token-${row.id}`
        })), { upsert: true });
      }
      const accessedAt = new Date("2099-01-10"), lastEditedAt = new Date("2099-01-11");
      for (const coachId of [f.coachId, inactiveId, deletedId]) {
        const row = coachFixtureRow("CoachScheduleAccessLog", { coachId, yearMonth: "2099-01", accessedAt, lastEditedAt: coachId === f.coachId ? lastEditedAt : null });
        await f.store.collection("CoachScheduleAccessLog").insertOne(encodeMongoRuntimeDocument("CoachScheduleAccessLog", row));
      }
      await f.store.collection("CoachScheduleAccessLog").insertOne(encodeMongoRuntimeDocument("CoachScheduleAccessLog", coachFixtureRow("CoachScheduleAccessLog", {
        coachId: f.otherCoachId, yearMonth: "2099-02", accessedAt, lastEditedAt
      })));
      const registration = await f.repo.getScheduleRegistration("2099-01"), status = await f.repo.getScheduleStatus("2099-01");
      assert.deepEqual(registration.coaches, [f.otherCoachId, f.coachId].map(id => ({
        id, name: id === f.coachId ? "가상 나" : "가상 가", workType: "synthetic-work", accessToken: `synthetic-token-${id}`
      })));
      assert.deepEqual(status.activeCoaches, registration.coaches.map(({ id, name }) => ({ id, name })));
      const sort = <T extends { coachId: string }>(rows: T[]) => rows.sort((a, b) => a.coachId.localeCompare(b.coachId));
      assert.deepEqual(sort(registration.accessLogs), sort([f.coachId, inactiveId, deletedId].map(coachId => ({ coachId, lastEditedAt: coachId === f.coachId ? lastEditedAt : null }))));
      assert.deepEqual(sort(status.accessLogs), sort(registration.accessLogs.map(row => ({ ...row, accessedAt }))));
      assert.deepEqual((await f.repo.getScheduleRegistration("2099-03")).accessLogs, []);
      assert.deepEqual((await f.repo.getScheduleStatus("2099-03")).accessLogs, []);
      noCompanions([registration, status]);
    });

    // Inject failures after a real server insert so the assertions require transaction rollback.
    for (const stage of ["audit", "history"] as const) for (const action of actions) {
      await suite.test(`${action}: ${stage} insertion failure rolls back the note, EDIT_HISTORY and ActivityChange`, async () => {
        const f = await fixture(), id = await f.seed(), before = await f.snapshot();
        const original = Collection.prototype.insertOne;
        let injected = 0;
        const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const result = await original.apply(this, args);
          if ((stage === "audit" && this.collectionName === `${f.options.namespace}_ActivityChange`)
            || (stage === "history" && this.collectionName === `${f.options.namespace}_CoachContentEntry` && args[0].kind === "EDIT_HISTORY")) {
            injected++;
            throw new Error("Synthetic content transaction failure");
          }
          return result;
        });
        try { await assert.rejects(f.mutate(action, id), hasCode("COACH_CONTENT_WRITE_FAILED")); }
        finally { patch.mock.restore(); }
        assert.equal(injected, 1);
        assert.deepEqual(await f.snapshot(), before, "no partial business/audit writes survive");
      });
    }

    await suite.test("concurrent warning toggles serialize without lost updates or duplicate history/audits", async () => {
      const f = await fixture(), id = await f.seed();
      for (const count of [2, 4, 3]) {
        const results = await Promise.all(Array.from({ length: count }, () => f.mutate("toggle", id)));
        assert.equal(results.filter(row => row.flaggedAt !== null).length, Math.ceil(count / 2));
        assert.equal((await f.store.one("CoachContentEntry", { _id: id }))?.flaggedAt !== null, count === 3);
      }
      const histories = await f.store.scan("CoachContentEntry", { kind: "EDIT_HISTORY" });
      assert.equal(histories.length, 9);
      assert.equal(histories.filter(row => (row.content as string).startsWith("메모 경고 설정:")).length, 5);
      const audits = await f.store.scan("ActivityChange", {});
      assert.equal(audits.length, 9); assert.equal(new Set(audits.map(row => row.requestId)).size, 9);
      assert.ok(audits.every(row => row.targetId === id && row.action === "update"));
    });

    for (const firstAction of ["update", "toggle"] as const) {
      await suite.test(`initial guard conflict retries ${firstAction} then ${firstAction === "update" ? "toggle" : "update"} without lost fields`, async () => {
        const f = await fixture(), id = await f.seed();
        const held = deferred(), release = deferred(), collided = deferred();
        const firstRequest = randomUUID(), secondRequest = randomUUID();
        const guardName = `${f.options.namespace}_CoachSchedulingGuard`;
        assert.equal(await f.store.db.collection(guardName).countDocuments(), 0);
        const original = Collection.prototype.updateOne;
        let firstHeld = false, attempts = 0, conflicts = 0, firstUpserted = 0;
        const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          const relevant = this.collectionName === guardName;
          const request = activityContext.getStore()?.requestId;
          if (relevant && request === secondRequest) attempts++;
          try {
            const result = await original.apply(this, args);
            if (relevant && request === firstRequest && !firstHeld) {
              firstHeld = true; firstUpserted = result.upsertedCount; held.resolve(); await release.promise;
            }
            return result;
          } catch (error) {
            if (relevant && request === secondRequest && error instanceof MongoServerError && [112, 11000].includes(error.code as number)) {
              conflicts++; collided.resolve();
            }
            throw error;
          }
        });
        const calls: Promise<unknown>[] = [];
        const invoke = (action: "update" | "toggle", request: string) => {
          const pending = f.run(() => action === "update" ? f.repo.updateNote(f.coachId, id, "동시 본문 수정", editor) : f.repo.toggleNoteWarning(f.coachId, id, editor), request);
          calls.push(pending); void pending.catch(() => {}); return pending;
        };
        try {
          const first = invoke(firstAction, firstRequest);
          await within(held.promise, "first guard upsert");
          const second = invoke(firstAction === "update" ? "toggle" : "update", secondRequest);
          await within(collided.promise, "real first-upsert write conflict");
          release.resolve(); await Promise.all([first, second]);
        } finally { release.resolve(); await Promise.allSettled(calls); patch.mock.restore(); }
        assert.equal(firstUpserted, 1); assert.ok(conflicts >= 1); assert.ok(attempts >= 2);
        assert.equal(await f.store.db.collection(guardName).countDocuments(), 1);
        const row = await f.store.one("CoachContentEntry", { _id: id });
        assert.equal(row?.content, "동시 본문 수정"); assert.ok(row?.flaggedAt instanceof Date);
        assert.equal(row.authorEmail, author.email);
        assert.equal(await f.store.collection("CoachContentEntry").countDocuments({ kind: "EDIT_HISTORY" }), 2);
        assert.equal(await f.store.collection("ActivityChange").countDocuments(), 2);
      });
    }

    await suite.test("duplicate guard retry exhaustion aborts all writes and a later healthy request succeeds", async () => {
      const f = await fixture(), id = await f.seed(), before = await f.snapshot();
      const original = Collection.prototype.updateOne;
      let attempts = 0;
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const result = await original.apply(this, args);
        if (this.collectionName === `${f.options.namespace}_CoachSchedulingGuard`) {
          attempts++;
          throw new MongoServerError({ code: 11000, message: "Synthetic duplicate guard" });
        }
        return result;
      });
      try { await assert.rejects(f.mutate("update", id), hasCode("COACH_CONTENT_WRITE_FAILED")); }
      finally { patch.mock.restore(); }
      assert.equal(attempts, 5);
      assert.deepEqual(await f.snapshot(), before);
      assert.equal(await f.store.db.collection(`${f.options.namespace}_CoachSchedulingGuard`).countDocuments(), 0);
      assert.equal((await f.mutate("update", id)).content, `${privateContent} 수정`);
    });

    for (const corruption of ["encryption-key", "index-key", "ciphertext", "hmac"] as const) {
      await suite.test(`${corruption} mismatch rejects content reads and writes without private errors or partial changes`, async () => {
        const f = await fixture(), id = await f.seed();
        const raw = await f.store.collection("CoachContentEntry").findOne({ _id: id }); assert.ok(raw);
        const encryptionKeys = process.env.PII_ENCRYPTION_KEYS!, indexKey = process.env.PII_INDEX_KEY!;
        if (corruption === "encryption-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
        if (corruption === "index-key") process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
        if (corruption === "hmac") await f.store.collection("CoachContentEntry").updateOne({ _id: id }, { $set: { contentPiiIndex: raw.contentPiiIndex === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64) } });
        if (corruption === "ciphertext") {
          const parts = (raw.content as string).split(":");
          parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
          await f.store.collection("CoachContentEntry").updateOne({ _id: id }, { $set: { content: parts.join(":") } });
        }
        const before = await f.snapshot();
        const safeFailure = (code: string) => (error: unknown) => {
          assert.ok(hasCode(code)(error));
          for (const secret of [privateContent, author.email, author.name]) assert.ok(!String(error).includes(secret));
          return true;
        };
        try {
          await assert.rejects(f.repo.listNotes(f.coachId), safeFailure("COACH_CONTENT_READ_FAILED"));
          await assert.rejects(f.mutate("update", id), safeFailure("COACH_CONTENT_WRITE_FAILED"));
          assert.deepEqual(await f.snapshot(), before);
        } finally {
          process.env.PII_ENCRYPTION_KEYS = encryptionKeys; process.env.PII_INDEX_KEY = indexKey;
          await f.store.collection("CoachContentEntry").replaceOne({ _id: id }, raw);
        }
        assert.equal((await f.repo.listNotes(f.coachId))[0].content, privateContent);
      });
    }

    for (const first of ["content", "purge"] as const) for (const action of actions) {
      await suite.test(`${action}/purge race: ${first} commits first without orphan or post-purge history`, async () => {
        const f = await fixture(true), id = await f.seed();
        const held = deferred(), release = deferred(), contending = deferred();
        const insert = Collection.prototype.insertOne, remove = Collection.prototype.deleteOne, update = Collection.prototype.updateOne;
        let paused = false, observeContender = false;
        const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          const result = await insert.apply(this, args);
          if (first === "content" && !paused && this.collectionName === `${f.options.namespace}_CoachContentEntry` && args[0].kind === "EDIT_HISTORY") {
            paused = true; held.resolve(); await release.promise;
          }
          return result;
        });
        const deletePatch = mock.method(Collection.prototype, "deleteOne", async function (this: Collection, ...args: Parameters<Collection["deleteOne"]>) {
          const result = await remove.apply(this, args);
          if (first === "purge" && !paused && this.collectionName === `${f.options.namespace}_Coach` && (args[0] as { _id?: unknown } | undefined)?._id === f.coachId) {
            paused = true; held.resolve(); await release.promise;
          }
          return result;
        });
        const updatePatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          if (observeContender && this.collectionName === `${f.options.namespace}_CoachSchedulingGuard` && (args[0] as { _id?: unknown } | undefined)?._id === f.coachId) contending.resolve();
          return update.apply(this, args);
        });
        const pending: Promise<unknown>[] = [];
        const track = (promise: Promise<unknown>) => { pending.push(promise); void promise.catch(() => {}); return promise; };
        try {
          const leader = track(first === "content" ? f.mutate(action, id) : f.run(() => f.admin.purgeDeletedCoach(f.coachId)));
          await within(Promise.race([held.promise, leader.then(() => { throw new Error("Leader finished before transaction barrier"); })]), "leader transaction barrier");
          observeContender = true;
          let settled = false;
          const follower = track(first === "content" ? f.run(() => f.admin.purgeDeletedCoach(f.coachId)) : f.mutate(action, id));
          void follower.then(() => { settled = true; }, () => { settled = true; });
          await within(contending.promise, "competing coach guard write");
          await new Promise(done => setTimeout(done, 100));
          assert.equal(settled, false, "the competing writer must wait for the held transaction");
          release.resolve();
          if (first === "content") { await leader; assert.equal(await follower, true); }
          else { assert.equal(await leader, true); await assert.rejects(follower, hasCode("COACH_NOT_FOUND")); }
        } finally {
          release.resolve();
          await Promise.allSettled(pending);
          updatePatch.mock.restore(); deletePatch.mock.restore(); insertPatch.mock.restore();
        }
        assert.equal(await f.store.collection("Coach").countDocuments({ _id: f.coachId }), 0);
        assert.equal(await f.store.collection("CoachContentEntry").countDocuments({ coachId: f.coachId }), 0);
        assert.equal(await f.store.collection("Coach").countDocuments({ _id: f.otherCoachId }), 1);
        const audits = await f.store.scan("ActivityChange", { targetType: "coach_content_entries" });
        assert.equal(audits.length, first === "purge" ? 1 : action === "create" ? 3 : 2);
        await assert.rejects(f.mutate(action, id), hasCode("COACH_NOT_FOUND"));
        assert.equal(await f.store.collection("CoachContentEntry").countDocuments({ coachId: f.coachId }), 0);
      });
    }
  } finally {
    try {
      if (connected) {
        assert.match(databaseName, /^hub_om_shadow_coach_content_[a-f0-9]{16}$/);
        await client.db(databaseName).dropDatabase();
      }
    } finally {
      try { await client.close(); }
      finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
    }
  }
});
