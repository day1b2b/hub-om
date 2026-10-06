import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Binary, MongoClient } from "mongodb";
import pg from "pg";
import { activityContext } from "../activity/context";
import { getPrismaClient } from "./prisma";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, decodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { originalAnnouncementOracle } from "./announcementOriginalOracle.fixture";
import { PrismaAnnouncementRepository } from "./announcements/prismaAnnouncementRepository";
import type { AnnouncementRepository } from "./announcements/announcementRepository";
import { MongoAnnouncementRepository, prepareMongoAnnouncementStore } from "./mongoAnnouncementRepository";

const pgUrl = process.env.ANNOUNCEMENT_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_ANNOUNCEMENT_TEST_URI;
const id = (n: number) => `aabbccdd-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number) => new Date(`2099-01-${String(n).padStart(2, "0")}T00:00:00.000Z`);
const actor = { requestId: id(9000), route: "/api/announcements/[id]", method: "PUT", actorEmail: "synthetic-editor@example.invalid", actorName: "Synthetic private editor", actorType: "user" as const };
const models = ["Announcement", "AnnouncementAttachment", "ActivityChange"] as const;
const tables = ["announcements", "announcement_attachments", "activity_changes"] as const;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bytes = Uint8Array.from([0, 255, 128, 13, 10, 0, 42]);
function assertEncryptedBytes(stored: unknown, original: Uint8Array, isMongo: boolean) {
  let actual: Buffer;
  if (isMongo) {
    assert.ok(stored instanceof Binary);
    assert.equal(stored.sub_type, 0);
    actual = Buffer.from(stored.value());
  } else {
    // raw() uses row_to_json, whose bytea representation is hexadecimal.
    assert.equal(typeof stored, "string");
    assert.match(stored as string, /^\\x(?:[0-9a-f]{2})*$/);
    actual = Buffer.from((stored as string).slice(2), "hex");
  }
  assert.equal(actual.equals(Buffer.from(original)), false, "stored bytes must differ from the exact original");
}
const file = (name: string, data = bytes) => ({ fileName: name, mimeType: "application/octet-stream", size: data.length, data });
const aliases = (value: string) => {
  const compact = value.replaceAll("-", "");
  return [value.toUpperCase(), compact, `{${value.toUpperCase()}}`, compact.match(/.{4}/g)!.join("-")];
};
const errorClass = (error: unknown) => (error as { code?: string }).code === "P2025" ? "missing-write" : "invalid-input";

test("5f9d291 independent query/select/nested-write oracle integrity", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("./announcementOriginalOracle.fixture.ts", import.meta.url))).digest("hex"), "10aaf4606b7a018b3bd05ad56125cbe037794068a69d42e64b1700b9f73b964f");
});

test("raw byte assertion rejects plaintext Binary and bytea, including empty originals", () => {
  for (const original of [bytes, new Uint8Array()]) {
    assert.throws(() => assertEncryptedBytes(new Binary(Buffer.from(original)), original, true), assert.AssertionError);
    assert.throws(() => assertEncryptedBytes(`\\x${Buffer.from(original).toString("hex")}`, original, false), assert.AssertionError);
  }
});

function fixtures() {
  const announcements = [1, 2, 3].map(n => coachFixtureRow("Announcement", {
    id: id(n), title: `Synthetic private title ${n}`, content: `<p>Synthetic private body ${n}</p>`,
    authorEmail: `synthetic-author-${n}@example.invalid`, authorName: n === 1 ? null : "Synthetic private author",
    createdAt: at(n), updatedAt: at(n), deletedAt: n === 3 ? at(4) : null, deletedBy: n === 3 ? "synthetic-deleter@example.invalid" : null
  }));
  const attachments = [[11, 1, 2], [12, 1, 1], [21, 2, 3], [31, 3, 4]].map(([n, parent, date]) => coachFixtureRow("AnnouncementAttachment", {
    id: id(n), announcementId: id(parent), ...file(`가상 첨부 ${n} #%.bin`, n === 12 ? new Uint8Array() : bytes), createdAt: at(date)
  }));
  return { announcements, attachments };
}

/**
 * Opt-in destructive reset is restricted to this exact disposable loopback PG.
 * Main owns runtime startup/execution. No dotenv, production settings or fallback.
 * ID normalization is limited to generated create/attachment/audit IDs, discovered
 * from returned rows. Only generated createdAt/updatedAt/deletedAt/occurredAt are
 * normalized; fixed fixture timestamps, every DTO field and nullable audit field
 * remain comparable. Ciphertexts are compared within a backend, never cross-backend.
 */
test("real original PG / new PG / native Mongo announcement parity", { skip: !pgUrl || !mongoUri, timeout: 180_000 }, async suite => {
  assert.equal(pgUrl, "postgresql://synthetic@127.0.0.1:56669/announcements_parity");
  const uri = new URL(mongoUri!);
  assert.equal(uri.protocol, "mongodb:"); assert.equal(uri.hostname, "127.0.0.1"); assert.ok(uri.port);
  assert.equal(uri.username, ""); assert.equal(uri.password, ""); assert.equal(uri.pathname, "/"); assert.equal(uri.hash, "");
  assert.deepEqual([...uri.searchParams.keys()], ["replicaSet"]); assert.ok(uri.searchParams.get("replicaSet"));
  const envNames = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DATABASE_URL: pgUrl, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: pgUrl });
  const client = new MongoClient(mongoUri!, { serverSelectionTimeoutMS: 5000 });
  const namespace = `shadow_announcements_pg_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName: "hub_om_shadow_announcements_parity", namespace, allowShadowWrites: true as const };
  let db: ReturnType<typeof getPrismaClient> | undefined;
  let sqlConnected = false, mongoConnected = false;
  try {
    await sql.connect(); sqlConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0], { db: "announcements_parity", usr: "synthetic" });
    await client.connect(); mongoConnected = true;
    const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.isWritablePrimary, true); assert.equal(hello.setName, uri.searchParams.get("replicaSet"));
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const migrationRoot = path.resolve("prisma/migrations");
    const migrations = readdirSync(migrationRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrations.length, 45);
    for (const migration of migrations) await sql.query(readFileSync(path.join(migrationRoot, migration, "migration.sql"), "utf8"));
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    db = getPrismaClient(); const prisma = db;
    const data = fixtures();
    const seedPg = async () => {
      await sql.query("TRUNCATE announcement_attachments, announcements, activity_changes CASCADE");
      await prisma.announcement.createMany({ data: data.announcements as never });
      await prisma.announcementAttachment.createMany({ data: data.attachments as never });
    };
    await prepareMongoAnnouncementStore(options);
    const mongo = await MongoAnnouncementRepository.open(options), store = new MongoOperationStore(options, models);
    await store.collection("Announcement").insertMany(data.announcements.map(row => encodeMongoRuntimeDocument("Announcement", row)));
    await store.collection("AnnouncementAttachment").insertMany(data.attachments.map(row => encodeMongoRuntimeDocument("AnnouncementAttachment", row)));
    const results: unknown[] = [];
    for (const backend of ["original PG", "new PG", "native Mongo"] as const) await suite.test(backend, async () => {
      const isMongo = backend === "native Mongo";
      if (!isMongo) await seedPg();
      const repo: AnnouncementRepository = isMongo ? mongo : backend === "new PG" ? new PrismaAnnouncementRepository() : originalAnnouncementOracle(prisma);
      const raw = async (model: typeof models[number]): Promise<MongoRow[]> => isMongo
        ? store.collection(model).find({}).sort({ _id: 1 }).toArray()
        : (await sql.query(`SELECT row_to_json(t) AS row FROM ${tables[models.indexOf(model)]} t ORDER BY id`)).rows.map(row => row.row);
      const logical = async (model: typeof models[number]): Promise<MongoRow[]> => {
        if (isMongo) return (await raw(model)).map(row => decodeMongoRuntimeDocument(model, row as Parameters<typeof decodeMongoRuntimeDocument>[1]));
        if (model === "Announcement") return prisma.announcement.findMany({ orderBy: { id: "asc" } }) as unknown as Promise<MongoRow[]>;
        if (model === "AnnouncementAttachment") return prisma.announcementAttachment.findMany({ orderBy: { id: "asc" } }) as unknown as Promise<MongoRow[]>;
        return prisma.activityChange.findMany({ orderBy: { id: "asc" } }) as unknown as Promise<MongoRow[]>;
      };
      const snapshot = async () => Promise.all(models.map(async model => fingerprint(await raw(model))));
      const rowId = (row: MongoRow) => String(row.id ?? row._id);
      const rawRow = async (model: typeof models[number], value: string) => (await raw(model)).find(row => rowId(row) === value)!;
      const readAll = async (value: string) => ({
        detail: await repo.getDetail(value), page: await repo.getDetailPage(value), edit: await repo.getEditPage(value),
        update: await repo.getUpdateState(value), delete: await repo.getDeleteState(value)
      });
      const events: unknown[] = [], idMap = new Map<string, string>();
      // Register only generated IDs. Fixture identity, requestId and FK identity are preserved.
      const normalize = (value: unknown): unknown => {
        if (value instanceof Date) return value.getUTCFullYear() === 2099 ? value.toISOString() : "<generated-time>";
        if (value instanceof Uint8Array) return [...value];
        if (typeof value === "string") return idMap.get(value) ?? value;
        if (Array.isArray(value)) return value.map(entry => normalize(entry));
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, normalize(entry)]));
        return value;
      };
      let request = 9100;
      const run = async <T>(label: string, work: () => Promise<T>) => {
        await delay(4);
        const requestId = id(request++), start = Date.now();
        const result = await activityContext.run({ ...actor, requestId }, work);
        const finished = Date.now();
        const audits = (await logical("ActivityChange")).filter(row => row.requestId === requestId);
        for (const row of audits) {
          assert.ok(row.occurredAt instanceof Date && row.occurredAt.getTime() >= start && row.occurredAt.getTime() <= Date.now());
          assert.equal(row.actorEmail, actor.actorEmail); assert.equal(row.actorName, actor.actorName);
          const allowed = row.targetType === "announcement_attachments" ? ["announcement_id", "mime_type", "size"] : [];
          assert.ok(["announcements", "announcement_attachments"].includes(String(row.targetType)));
          for (const [field, delta] of Object.entries(row.changes as MongoRow)) if (!allowed.includes(field)) assert.deepEqual(delta, { redacted: true });
        }
        console.log(`[announcement-pg] backend=${backend} scenario=${label} auditDelta=${audits.length}`);
        events.push({ label, result }); return { result, audits, start, finished };
      };
      const rejects = async (label: string, work: () => Promise<unknown>, expected = "invalid-input") => {
        const before = await snapshot(); let caught = false;
        try { await activityContext.run({ ...actor, requestId: id(request++) }, work); }
        catch (error) { caught = true; assert.equal(errorClass(error), expected, label); }
        assert.equal(caught, true, label); assert.deepEqual(await snapshot(), before, label);
        events.push({ label, error: expected });
      };
      const beforeRead = await snapshot();
      const list = await repo.list(), views = await readAll(id(1));
      assert.deepEqual(list.map(row => row.id), [id(2), id(1)]);
      assert.deepEqual(list[1], { id: id(1), title: "Synthetic private title 1", authorEmail: "synthetic-author-1@example.invalid", authorName: null, createdAt: at(1), updatedAt: at(1) });
      const metadata = (n: number) => ({ id: id(n), fileName: `가상 첨부 ${n} #%.bin`, mimeType: "application/octet-stream", size: n === 12 ? 0 : 7 });
      assert.deepEqual(views.detail, { ...list[1], content: "<p>Synthetic private body 1</p>", attachments: [metadata(12), metadata(11)] });
      const { updatedAt: omitted, ...page } = views.detail!; void omitted;
      assert.deepEqual(views.page, { ...page, attachments: [12, 11].map(n => ({ id: id(n), fileName: metadata(n).fileName, size: metadata(n).size })) });
      assert.deepEqual(views.edit, { id: id(1), title: list[1].title, content: "<p>Synthetic private body 1</p>", attachments: views.page!.attachments });
      assert.deepEqual(views.update, { id: id(1), deletedAt: null, _count: { attachments: 2 } });
      assert.deepEqual(views.delete, { id: id(1), deletedAt: null });
      const deleted = await readAll(id(3));
      assert.equal(deleted.detail, null); assert.equal(deleted.page, null); assert.equal(deleted.edit, null);
      assert.deepEqual(deleted.update, { id: id(3), deletedAt: at(4), _count: { attachments: 1 } });
      assert.deepEqual(deleted.delete, { id: id(3), deletedAt: at(4) });
      assert.deepEqual(await readAll(id(999)), { detail: null, page: null, edit: null, update: null, delete: null });
      for (const value of aliases(id(1))) assert.deepEqual(await readAll(value), views);
      for (const value of aliases(id(11))) assert.deepEqual(normalize(await repo.download(id(1), value)), { fileName: metadata(11).fileName, mimeType: "application/octet-stream", data: [...bytes] });
      for (const value of aliases(id(1))) assert.deepEqual(normalize(await repo.download(value, id(11))), { fileName: metadata(11).fileName, mimeType: "application/octet-stream", data: [...bytes] });
      assert.deepEqual(normalize(await repo.download(id(1), id(12))), { fileName: metadata(12).fileName, mimeType: "application/octet-stream", data: [] });
      for (const [parent, attachment] of [[1, 21], [3, 31], [999, 11], [1, 999]]) assert.equal(await repo.download(id(parent), id(attachment)), null);
      assert.deepEqual(await snapshot(), beforeRead);
      events.push({ label: "initial DTOs", list, views, deleted });
      for (const invalid of ["not-a-uuid", "", " ", ` ${id(1)}`, `${id(1).replaceAll("-", "").slice(0, 3)}-${id(1).replaceAll("-", "").slice(3)}`]) {
        for (const method of ["getDetail", "getDetailPage", "getEditPage", "getUpdateState", "getDeleteState"] as const) await rejects(`${method}-invalid`, () => repo[method](invalid));
        await rejects("download-invalid-parent", () => repo.download(invalid, id(11)));
        await rejects("download-invalid-file", () => repo.download(id(1), invalid));
        await rejects("update-invalid-parent", () => repo.update({ id: invalid, title: "Synthetic new", content: "<p>Synthetic new</p>", removeAttachmentIds: [], attachments: [] }));
        await rejects("delete-invalid-parent", () => repo.softDelete(invalid, null));
        await rejects("update-invalid-remove", () => repo.update({ id: id(1), title: "Synthetic new", content: "<p>Synthetic new</p>", removeAttachmentIds: [invalid], attachments: [] }));
      }
      const baseUpdate = { id: id(1), title: "Synthetic private title 1", content: "<p>Synthetic private body 1</p>", removeAttachmentIds: [] as string[], attachments: [] as ReturnType<typeof file>[] };
      await rejects("update-missing", () => repo.update({ ...baseUpdate, id: id(999) }), "missing-write");
      await rejects("delete-missing", () => repo.softDelete(id(999), null), "missing-write");
      const originalRaw = await rawRow("Announcement", id(1)), attachmentRaw = await raw("AnnouncementAttachment");
      const authorColumns = isMongo ? ["authorEmail", "authorEmailPiiIndex", "authorName", "authorNamePiiIndex", "createdAt"] : ["author_email", "author_email_pii_index", "author_name", "author_name_pii_index", "created_at"];
      const authorRaw = (row: MongoRow) => Object.fromEntries(authorColumns.map(key => [key, row[key]]));
      for (const alias of aliases(id(1))) {
        const previous = (await repo.getDetail(id(1)))!.updatedAt;
        const replay = await run("same-PII-PUT-alias", () => repo.update({ ...baseUpdate, id: alias }));
        assert.equal(replay.audits.length, 0);
        // Fixtures start in 2099; a real write replaces that with request time.
        // Original PG, new PG and Mongo all legitimately move this value backwards.
        const updated = replay.result.updatedAt.getTime();
        assert.ok(updated >= replay.start && updated <= replay.finished, "updatedAt is within the write request");
        assert.notEqual(updated, previous.getTime(), "same-value PUT still changes updatedAt");
        assert.deepEqual(authorRaw(await rawRow("Announcement", id(1))), authorRaw(originalRaw));
        assert.deepEqual(await raw("AnnouncementAttachment"), attachmentRaw);
      }
      // deleteMany is scoped by the parent: duplicate, foreign and missing IDs are legal.
      const mixed = await run("mixed-remove-add", () => repo.update({ ...baseUpdate, title: "Synthetic revised private", removeAttachmentIds: [aliases(id(11))[0], aliases(id(11))[1], id(21), id(999)], attachments: [file("Synthetic replacement.bin")] }));
      assert.equal(mixed.result.authorName, null); assert.equal(mixed.result.authorEmail, "synthetic-author-1@example.invalid");
      assert.deepEqual(authorRaw(await rawRow("Announcement", id(1))), authorRaw(originalRaw));
      assert.equal(await repo.download(id(1), id(11)), null);
      for (const n of [12, 21, 31]) assert.deepEqual(await rawRow("AnnouncementAttachment", id(n)), attachmentRaw.find(row => rowId(row) === id(n)));
      const replacement = (await repo.getDetail(id(1)))!.attachments.find(row => row.fileName === "Synthetic replacement.bin")!;
      idMap.set(replacement.id, "<replacement-id>");
      assert.deepEqual(normalize(await repo.download(id(1), replacement.id)), { fileName: "Synthetic replacement.bin", mimeType: "application/octet-stream", data: [...bytes] });
      const repeat = await run("replay-remove-no-add", () => repo.update({ ...baseUpdate, title: "Synthetic revised private", removeAttachmentIds: [id(11), id(11), id(21), id(999)] }));
      assert.equal(repeat.audits.length, 0);
      // Actual alias deletes, each on a genuinely present newly added attachment.
      for (let i = 0; i < 4; i++) {
        await run(`alias-add-${i}`, () => repo.update({ ...baseUpdate, attachments: [file(`Synthetic alias ${i}.bin`)] }));
        const attachment = (await repo.getDetail(id(1)))!.attachments.find(row => row.fileName === `Synthetic alias ${i}.bin`)!;
        idMap.set(attachment.id, `<alias-file-${i}>`);
        const removed = await run(`alias-remove-${i}`, () => repo.update({ ...baseUpdate, removeAttachmentIds: [aliases(attachment.id)[i]] }));
        assert.equal(removed.audits.filter(row => row.targetType === "announcement_attachments" && row.action === "delete").length, 1);
        assert.equal(await repo.download(id(1), attachment.id), null);
      }
      // Generated creates exercise absent-vs-null trigger diffs and nested write audit.
      for (const name of [null, "Synthetic created author"] as const) {
        const label = name === null ? "null-author" : "named-author";
        const created = await run(`create-${label}`, () => repo.create({ title: "Synthetic created title", content: "<p>Synthetic created body</p>", authorEmail: "synthetic-created@example.invalid", authorName: name, attachments: name === null ? [] : [file("Synthetic created file.bin")] }));
        idMap.set(created.result.id, `<created-${label}>`);
        assert.equal(created.result.authorName, name); assert.equal(created.result.authorEmail, "synthetic-created@example.invalid");
        const detail = (await repo.getDetail(created.result.id))!;
        assert.equal(detail.attachments.length, name === null ? 0 : 1);
        for (const attachment of detail.attachments) idMap.set(attachment.id, `<created-file-${label}>`);
        events.push({ label: `created-detail-${label}`, detail });
      }
      const beforeDeleteFiles = await raw("AnnouncementAttachment");
      const beforeDeleteParent = await rawRow("Announcement", id(1));
      const preserveOnDelete = (row: MongoRow) => {
        const mutable = new Set(isMongo ? ["deletedAt", "deletedBy", "deletedByPiiIndex", "updatedAt"] : ["deleted_at", "deleted_by", "deleted_by_pii_index", "updated_at"]);
        return Object.fromEntries(Object.entries(row).filter(([key]) => !mutable.has(key)));
      };
      const deletedResult = await run("soft-delete-null-actor", () => repo.softDelete(aliases(id(1))[2], null));
      assert.equal(deletedResult.audits.length, 1); assert.equal(deletedResult.audits[0].action, "delete");
      assert.deepEqual(preserveOnDelete(await rawRow("Announcement", id(1))), preserveOnDelete(beforeDeleteParent));
      assert.deepEqual(deletedResult.audits[0].changes, { deleted_at: { redacted: true } });
      assert.deepEqual(await raw("AnnouncementAttachment"), beforeDeleteFiles);
      assert.equal(await repo.getDetail(id(1)), null); assert.equal(await repo.getDetailPage(id(1)), null); assert.equal(await repo.getEditPage(id(1)), null);
      assert.equal(await repo.download(id(1), id(12)), null);
      assert.ok(!(await repo.list()).some(row => row.id === id(1)));
      const hidden = (await logical("Announcement")).find(row => row.id === id(1))!;
      assert.equal(hidden.deletedBy, null);
      assert.equal((await rawRow("Announcement", id(1)))[isMongo ? "deletedByPiiIndex" : "deleted_by_pii_index"], null);
      assert.ok(hidden.deletedAt instanceof Date);
      const deleteTime = hidden.deletedAt.getTime();
      await run("stale-PUT-after-delete", () => repo.update({ ...baseUpdate, title: "Synthetic stale private" }));
      const afterStale = (await logical("Announcement")).find(row => row.id === id(1))!;
      assert.equal((afterStale.deletedAt as Date).getTime(), deleteTime); assert.equal(afterStale.title, "Synthetic stale private");
      assert.deepEqual(authorRaw(await rawRow("Announcement", id(1))), authorRaw(originalRaw));
      assert.deepEqual(await raw("AnnouncementAttachment"), beforeDeleteFiles);
      assert.equal(await repo.getDetail(id(1)), null); assert.equal(await repo.download(id(1), replacement.id), null);
      await run("soft-delete-named-actor", () => repo.softDelete(id(2), "synthetic-deleter@example.invalid"));
      const namedDeleted = (await logical("Announcement")).find(row => row.id === id(2))!;
      assert.equal(namedDeleted.deletedBy, "synthetic-deleter@example.invalid");
      // Companion columns are storage-only: PG's privacy wrapper strips them,
      // while the internal Mongo decoder retains them. Validate raw storage.
      const expectedIndex = (model: string, field: string, value: string) =>
        createHmac("sha256", Buffer.from(process.env.PII_INDEX_KEY!, "base64"))
          .update(model + "." + field).update("\0").update(value).digest("hex");
      const deleterIndex = (await rawRow("Announcement", id(2)))[isMongo ? "deletedByPiiIndex" : "deleted_by_pii_index"];
      assert.equal(typeof deleterIndex, "string");
      assert.equal(deleterIndex, expectedIndex("Announcement", "deletedBy", "synthetic-deleter@example.invalid"));
      for (const storedAudit of await raw("ActivityChange")) {
        for (const [field, column, plaintext] of [
          ["actorEmailPiiIndex", "actor_email_pii_index", actor.actorEmail],
          ["actorNamePiiIndex", "actor_name_pii_index", actor.actorName]
        ] as const) {
          const stored = storedAudit[isMongo ? field : column];
          assert.equal(typeof stored, "string");
          assert.equal(stored, expectedIndex("ActivityChange", field.replace("PiiIndex", ""), plaintext));
        }
      }
      const allAudits = await logical("ActivityChange");
      // Compare the public logical audit surface: PG strips storage companions.
      // Raw HMACs were independently checked above; remove only those two
      // companion keys plus nondeterministic audit identity/time. Retain all
      // nullable values, diff fields/actions/targets/context and mapped FKs.
      const audits = allAudits.map(row => normalize(Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "occurredAt", "actorEmailPiiIndex", "actorNamePiiIndex"].includes(key)))));
      audits.sort((a, b) => {
        const key = (value: unknown) => { const row = value as MongoRow; return [row.requestId, row.targetType, row.targetId, row.action].join("|"); };
        return key(a).localeCompare(key(b));
      });
      for (const model of models) {
        const serialized = JSON.stringify(await raw(model));
        for (const privateValue of ["Synthetic private", "Synthetic revised", "Synthetic stale", "Synthetic created", "synthetic-author", "synthetic-editor", "synthetic-created", "synthetic-deleter", "가상 첨부", "Synthetic replacement", "Synthetic alias"]) assert.equal(serialized.includes(privateValue), false, `${model}: raw PII`);
      }
      // Byte ciphertext must differ from plaintext, including binary, not just strings.
      for (const row of await raw("AnnouncementAttachment")) {
        const original = rowId(row) === id(12) ? new Uint8Array() : bytes;
        assertEncryptedBytes(row.data, original, isMongo);
      }
      results.push({ events: normalize(events), audits, final: normalize(await readAll(id(1))) });
    });
    assert.equal(results.length, 3);
    assert.deepEqual(results[1], results[0], "new PG equals frozen original PG");
    assert.deepEqual(results[2], results[0], "native Mongo equals frozen original PG");
  } finally {
    try { if (db) await db.$disconnect(); }
    finally {
      try { if (sqlConnected) await sql.end(); }
      finally {
        try {
          if (mongoConnected) {
            assert.match(namespace, /^shadow_announcements_pg_[a-f0-9]{16}$/);
            for (const collection of await client.db(options.databaseName).listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray()) {
              assert.ok(collection.name.startsWith(`${namespace}_`)); await client.db(options.databaseName).collection(collection.name).drop();
            }
          }
        } finally {
          await client.close();
          for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        }
      }
    }
  }
});
