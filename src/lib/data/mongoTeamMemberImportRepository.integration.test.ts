import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { Collection, MongoClient } from "mongodb";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoTeamMemberImportRepository, prepareMongoTeamMemberImportStore } from "./mongoTeamMemberImportRepository";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import type { TeamMemberImportEntry } from "./teamMemberImportRepository";

const uri = process.env.MONGODB_TEAM_MEMBER_IMPORT_TEST_URI;
test("team-member import is private, atomic, serialized and repeatable on Mongo", { skip: !uri, timeout: 120_000 }, async () => {
  const url = new URL(uri!); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port); assert.equal(url.username, "");
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  const databaseName = `hub_om_shadow_member_import_${randomBytes(6).toString("hex")}`, namespace = `shadow_member_import_${randomBytes(6).toString("hex")}`;
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const, saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const entry = (name: string, role: "OM" | "LD", sourceTeam: "TEAM_1" | "TEAM_2" | null, displayOrder: number): TeamMemberImportEntry => ({ name, normalizedName: name.replace(/\s+/g, "").toLowerCase(), role, sourceTeam, roleTitle: `${name} title`, calendarId: `${name} calendar`, displayOrder });
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const }; await prepareMongoTeamMemberImportStore(options);
    const store = new MongoOperationStore(options, ["Member"]), add = async (values: MongoRow) => { const row = coachFixtureRow("Member", { id: randomUUID(), role: "OM", sourceTeam: "TEAM_1", name: "Synthetic", normalizedName: "synthetic", roleTitle: null, calendarId: null, isActive: true, displayOrder: 1, ...values }); await store.collection("Member").insertOne(encodeMongoRuntimeDocument("Member", row)); return row; };
    const existing = await add({ name: "Synthetic Existing", normalizedName: "syntheticexisting", isActive: false }); await add({ name: "Synthetic Omitted", normalizedName: "syntheticomitted", displayOrder: 2 }); await add({ name: "Synthetic Other Group", normalizedName: "syntheticothergroup", role: "LD", sourceTeam: "TEAM_2", displayOrder: 3 });
    const repo = await MongoTeamMemberImportRepository.open(options), entries = [entry("Synthetic Existing", "OM", "TEAM_1", 9), entry("Synthetic Unclassified", "LD", null, 4)];
    const before = await store.collection("Member").find({}).sort({ _id: 1 }).toArray(); assert.deepEqual(await repo.importMembers(entries, false), { total: 2, inserted: 1, updated: 1, deactivated: 1 }); assert.deepEqual(await store.collection("Member").find({}).sort({ _id: 1 }).toArray(), before);
    assert.deepEqual(await repo.importMembers(entries, true), { total: 2, inserted: 1, updated: 1, deactivated: 1 });
    assert.equal((await store.one("Member", { _id: existing.id as string }))?.isActive, true); assert.equal((await store.one("Member", { _id: existing.id as string }))?.displayOrder, 9);
    assert.equal((await store.findPrivateEqual("Member", "normalizedName", "syntheticomitted"))[0]?.isActive, false); assert.equal((await store.findPrivateEqual("Member", "normalizedName", "syntheticothergroup"))[0]?.isActive, true);
    assert.deepEqual(await repo.importMembers(entries, true), { total: 2, inserted: 0, updated: 2, deactivated: 0 });
    const legacyDuplicate = entry("Synthetic Legacy Duplicate", "LD", null, 6);
    await add({ ...legacyDuplicate, id: randomUUID(), isActive: false }); await add({ ...legacyDuplicate, id: randomUUID(), isActive: false, displayOrder: 7 });
    assert.deepEqual(await repo.importMembers([legacyDuplicate], false), { total: 1, inserted: 0, updated: 1, deactivated: 1 });
    assert.deepEqual(await repo.importMembers([legacyDuplicate], true), { total: 1, inserted: 0, updated: 1, deactivated: 1 });
    const duplicates = await store.findPrivateEqual("Member", "normalizedName", legacyDuplicate.normalizedName); assert.equal(duplicates.length, 2); assert.ok(duplicates.every(row => row.isActive === true && row.displayOrder === 6));
    const stored = JSON.stringify(await store.collection("Member").find({}).toArray()); for (const plaintext of ["Synthetic Existing", "Synthetic Unclassified", "Synthetic Existing title", "Synthetic Unclassified calendar"]) assert.equal(stored.includes(plaintext), false);
    const snapshot = await store.collection("Member").find({}).sort({ _id: 1 }).toArray(), original = Collection.prototype.insertOne;
    const failure = mock.method(Collection.prototype, "insertOne", async function(this: Collection, ...args: Parameters<Collection["insertOne"]>) { if (this.collectionName === `${namespace}_Member`) throw new Error("private late canary"); return original.apply(this, args); });
    try { await assert.rejects(repo.importMembers([entry("Synthetic Rollback", "OM", "TEAM_2", 5)], true), error => !String(error).includes("canary")); } finally { failure.mock.restore(); }
    assert.deepEqual(await store.collection("Member").find({}).sort({ _id: 1 }).toArray(), snapshot);
    const second = await MongoTeamMemberImportRepository.open(options), concurrent = await Promise.all([repo.importMembers([entry("Synthetic Concurrent", "OM", null, 8)], true), second.importMembers([entry("Synthetic Concurrent", "OM", null, 8)], true)]);
    assert.deepEqual(concurrent.map(result => [result.inserted, result.updated]).sort(), [[0, 1], [1, 0]]); assert.equal((await store.findPrivateEqual("Member", "normalizedName", "syntheticconcurrent")).length, 1);
    const partial = { ...options, namespace: `${namespace}_partial` }; await client.db(databaseName).createCollection(`${partial.namespace}_Member`); const sentinel = client.db(databaseName).collection<{ _id: string }>(`${partial.namespace}_Member`); await sentinel.insertOne({ _id: "sentinel" }); const partialBefore = await sentinel.find({}).toArray(); await assert.rejects(MongoTeamMemberImportRepository.open(partial)); assert.deepEqual(await sentinel.find({}).toArray(), partialBefore);
  } finally { try { await client.db(databaseName).dropDatabase(); } finally { await client.close(); for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
});
