import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { Prisma } from "@prisma/client";
import { BSON, Binary, Decimal128 } from "mongodb";
import { mongoModelContracts, encodeMongoDocument, decodeMongoDocument } from "../migration/mongoDocumentCodec";
import { canonicalToBson, bsonToCanonical } from "../mongodb/shadowTarget";
import { privacyFields } from "../privacy/fields";
import { encrypt } from "../privacy/crypto";
import { MongoDbNull, MongoJsonNull, MongoRuntimeCodecError, mongoRuntimeContracts, mongoRuntimeModelNames, mongoRuntimeSourceId, mongoRuntimeBlindIndex, encodeMongoRuntimeDocument, decodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

const previous = { PII_ENCRYPTION_KEYS: process.env.PII_ENCRYPTION_KEYS, PII_ACTIVE_KEY_ID: process.env.PII_ACTIVE_KEY_ID, PII_INDEX_KEY: process.env.PII_INDEX_KEY, PII_ALLOW_PLAINTEXT_READS: process.env.PII_ALLOW_PLAINTEXT_READS };
process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
process.env.PII_ACTIVE_KEY_ID = "fixture";
process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const uuid = "00000000-0000-4000-8000-000000000001";
function fixture(model: string): Record<string, unknown> {
  const companions = new Set(Object.values(privacyFields[model]?.fields ?? {}).flatMap(policy => [policy.storage, policy.index]));
  return Object.fromEntries(Object.entries(mongoRuntimeContracts[model].fields).filter(([key]) => !companions.has(key)).map(([key, field]) => {
    const value = field.values?.[0] ?? (field.uuid ? uuid : ({ String: "synthetic pii:v1:ordinary text", Int: 1, Boolean: true, Decimal: "999999999999.99", DateTime: new Date("2026-09-22T00:00:00.000Z"), Bytes: Buffer.from([0, 255, 1]), Json: { nested: [null, "synthetic", { $date: "ordinary-json" }] } }[field.type]));
    return [key, field.list ? [value] : value];
  }));
}
function wire(document: BSON.Document) { return BSON.deserialize(BSON.serialize(document), { promoteBuffers: false }); }
function prismaToNeutral(model: string, row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === Prisma.DbNull ? MongoDbNull : value === Prisma.JsonNull ? MongoJsonNull : mongoRuntimeContracts[model].fields[key].type === "Decimal" && value !== null ? String(value) : value]));
}

test("all 35 static contracts match migration metadata and runtime import graph excludes Prisma, fs and migration", () => {
  assert.equal(mongoRuntimeModelNames.length, 35);
  assert.deepEqual(mongoRuntimeContracts, mongoModelContracts);
  for (const path of ["./mongoRuntimeCodec.ts", "../privacy/crypto.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()["'](?:node:fs|@prisma|.*migration\/|.*privacy\/fields["'])/);
    assert.doesNotMatch(source, /Prisma\.dmmf|readFileSync/);
  }
  assert.ok(Object.isFrozen(mongoRuntimeContracts.Course.fields));
});

test("all models and 125 private fields roundtrip both migration -> runtime and runtime -> migration over BSON wire", () => {
  let privateCount = 0;
  for (const model of mongoRuntimeModelNames) {
    const row = fixture(model);
    const old = encodeMongoDocument(model, row, { sourceMode: "plaintext" });
    const migrated = wire(canonicalToBson(model, old));
    assert.deepEqual(decodeMongoRuntimeDocument(model, migrated), prismaToNeutral(model, decodeMongoDocument(model, old)), model);
    const encoded = encodeMongoRuntimeDocument(model, row);
    const readback = wire(encoded);
    const decoded = decodeMongoRuntimeDocument(model, readback);
    assert.deepEqual(decoded, prismaToNeutral(model, decodeMongoDocument(model, bsonToCanonical(model, readback))), model);
    assert.equal(encoded._id, mongoRuntimeSourceId(model, row));
    for (const [key, value] of Object.entries(row)) assert.deepEqual(decoded[key], value, `${model}.${key}`);
    for (const [key, policy] of Object.entries(privacyFields[model]?.fields ?? {})) {
      privateCount++;
      assert.notDeepEqual(encoded[policy.storage ?? key], row[key]);
      if (policy.index) assert.equal(encoded[policy.index], migrated[policy.index]);
    }
  }
  assert.equal(privateCount, 125);
});

test("all nullable fields retain SQL NULL including private JSON/date companions", () => {
  for (const model of mongoRuntimeModelNames) {
    const row = fixture(model);
    for (const [key, field] of Object.entries(mongoRuntimeContracts[model].fields)) {
      if (Object.hasOwn(row, key) && field.nullable) row[key] = field.type === "Json" ? MongoDbNull : null;
    }
    const encoded = wire(encodeMongoRuntimeDocument(model, row));
    const decoded = decodeMongoRuntimeDocument(model, encoded);
    for (const [key, value] of Object.entries(row)) assert.deepEqual(decoded[key], value, `${model}.${key}`);
    assert.deepEqual(decoded, prismaToNeutral(model, decodeMongoDocument(model, bsonToCanonical(model, encoded))));
  }
});

test("JSON database null and JSON null remain distinct and tag-looking user JSON remains data", () => {
  const row = fixture("InstructorNote");
  for (const value of [MongoDbNull, MongoJsonNull, { $jsonNull: true }, { $json: { $date: "ordinary" } }]) {
    const encoded = wire(encodeMongoRuntimeDocument("InstructorNote", { ...row, notionProfile: value }));
    assert.deepEqual(decodeMongoRuntimeDocument("InstructorNote", encoded).notionProfile, value);
    assert.deepEqual(prismaToNeutral("InstructorNote", decodeMongoDocument("InstructorNote", bsonToCanonical("InstructorNote", encoded))).notionProfile, value);
  }
  assert.throws(() => encodeMongoRuntimeDocument("InstructorNote", { ...row, notionProfile: null }), /AMBIGUOUS_JSON_NULL/);
  assert.throws(() => encodeMongoRuntimeDocument("OmRequest", { ...fixture("OmRequest"), sessions: MongoDbNull }), /REQUIRED_NULL/);
});

test("missing PII and index/date companions in projections fail closed for every private model", () => {
  for (const model of mongoRuntimeModelNames) {
    const doc = encodeMongoRuntimeDocument(model, fixture(model));
    for (const [field, policy] of Object.entries(privacyFields[model]?.fields ?? {})) {
      for (const key of [field, policy.index, policy.storage].filter((key): key is string => Boolean(key))) {
        const incomplete = { ...doc }; delete incomplete[key];
        assert.throws(() => decodeMongoRuntimeDocument(model, incomplete), /TARGET_FIELD_COVERAGE/);
      }
      const index = policy.index;
      if (index) assert.throws(() => decodeMongoRuntimeDocument(model, { ...doc, [index]: "0".repeat(64) }), /INDEX_MISMATCH/);
    }
  }
});

test("ciphertext context swaps, truncation, wrong keys and plaintext fail closed even with legacy plaintext reads enabled", () => {
  const row = fixture("TeamUser");
  row.name = encrypt("synthetic inner envelope", "TeamUser.name");
  const doc = encodeMongoRuntimeDocument("TeamUser", row);
  assert.equal(decodeMongoRuntimeDocument("TeamUser", doc).name, row.name);
  assert.throws(() => decodeMongoRuntimeDocument("TeamUser", { ...doc, name: encrypt("synthetic", "Coach.name") }), /AUTHENTICATION/);
  assert.throws(() => decodeMongoRuntimeDocument("TeamUser", { ...doc, name: String(doc.name).slice(0, -5) }), /AUTHENTICATION/);
  process.env.PII_ALLOW_PLAINTEXT_READS = "true";
  assert.throws(() => decodeMongoRuntimeDocument("TeamUser", { ...doc, name: "SECRET_plain" }), error => error instanceof MongoRuntimeCodecError && !error.message.includes("SECRET"));
  const keys = process.env.PII_ENCRYPTION_KEYS;
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  try { assert.throws(() => decodeMongoRuntimeDocument("TeamUser", doc), /AUTHENTICATION/); }
  finally { process.env.PII_ENCRYPTION_KEYS = keys; }
});

test("native BSON types are enforced; decimal cannot silently round or lose precision", () => {
  const row = fixture("Course");
  const doc = encodeMongoRuntimeDocument("Course", row);
  assert.ok(doc.revenue instanceof Decimal128);
  assert.ok(doc.createdAt instanceof Date);
  assert.equal(decodeMongoRuntimeDocument("Course", wire(doc)).revenue, "999999999999.99");
  for (const value of [1.2, "1.001", "1e2", "1000000000000.00"]) assert.throws(() => encodeMongoRuntimeDocument("Course", { ...row, revenue: value }), /INVALID_DECIMAL/);
  assert.throws(() => decodeMongoRuntimeDocument("Course", { ...doc, revenue: "1.00" }), /INVALID_BSON_DECIMAL/);
  assert.throws(() => decodeMongoRuntimeDocument("Course", { ...doc, createdAt: "2026-09-22T00:00:00.000Z" }), /INVALID_BSON_DATE/);
  const attachment = encodeMongoRuntimeDocument("AnnouncementAttachment", fixture("AnnouncementAttachment"));
  assert.ok(attachment.data instanceof Binary);
  assert.throws(() => decodeMongoRuntimeDocument("AnnouncementAttachment", { ...attachment, data: new Binary(Buffer.alloc(16), 4) }), /INVALID_BSON_BYTES/);
});

test("unknown fields/models, enum, malformed date, cyclic JSON, and invalid numeric JSON do not leak values", () => {
  const row = fixture("Coach");
  for (const changes of [{ status: "SECRET_UNKNOWN" }, { id: "SECRET_BAD_UUID" }, { createdAt: "2026-02-30T00:00:00.000Z" }, { returnDateEncrypted: "SECRET_COMPANION" }]) {
    assert.throws(() => encodeMongoRuntimeDocument("Coach", { ...row, ...changes }), error => error instanceof MongoRuntimeCodecError && !error.message.includes("SECRET"));
  }
  const doc = encodeMongoRuntimeDocument("Coach", row);
  assert.throws(() => decodeMongoRuntimeDocument("Coach", { ...doc, unexpected: 1 }), /TARGET_FIELD_COVERAGE/);
  assert.throws(() => encodeMongoRuntimeDocument("Unknown", row), /UNKNOWN_MODEL/);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => encodeMongoRuntimeDocument("InstructorNote", { ...fixture("InstructorNote"), notionProfile: cycle }), /CYCLIC_JSON/);
  for (const value of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => encodeMongoRuntimeDocument("InstructorNote", { ...fixture("InstructorNote"), notionProfile: { value } }), /INVALID_JSON_NUMBER/);
});

test("compound UUID primary keys retain the migration identifier and blind indexes use existing field context", () => {
  const row: Record<string, unknown> = { ...fixture("CoachField"), tagId: "00000000-0000-4000-8000-000000000002" };
  const doc = encodeMongoRuntimeDocument("CoachField", row);
  assert.equal(doc._id, `compound:${JSON.stringify([row.coachId, row.tagId])}`);
  assert.deepEqual(decodeMongoRuntimeDocument("CoachField", doc), row);
  assert.throws(() => decodeMongoRuntimeDocument("CoachField", { ...doc, _id: "wrong" }), /TARGET_ID_MISMATCH/);
  const user = fixture("TeamUser");
  const encoded = encodeMongoRuntimeDocument("TeamUser", user);
  assert.equal(mongoRuntimeBlindIndex("TeamUser", "name", user.name), encoded.namePiiIndex);
  assert.throws(() => mongoRuntimeBlindIndex("Course", "createdAt", user.name), /NOT_INDEXED_PRIVATE_FIELD/);
});
