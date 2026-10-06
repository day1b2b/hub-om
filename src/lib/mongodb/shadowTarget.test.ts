import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { BSON, Binary, Decimal128 } from "mongodb";
import { Prisma } from "@prisma/client";
import { privacyFields } from "../privacy/fields";
import { decodeMongoDocument, encodeMongoDocument, mongoModelContracts, mongoModelNames, type CanonicalDocument } from "../migration/mongoDocumentCodec";
import { bsonToCanonical, canonicalToBson, NativeMongoShadowTarget } from "./shadowTarget";
const env = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY"] as const;
const previous = env.map(key => process.env[key]);
process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ test: randomBytes(32).toString("base64") });
process.env.PII_ACTIVE_KEY_ID = "test";
process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
after(() => env.forEach((key, index) => { const value = previous[index]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }));
function row(model: string) {
  const companions = new Set(Object.values(privacyFields[model]?.fields ?? {}).flatMap(policy => [policy.index, policy.storage]));
  return Object.fromEntries(Object.entries(mongoModelContracts[model].fields).filter(([key]) => !companions.has(key)).map(([key, field]) => {
    const value = field.values?.[0] ?? (field.uuid ? "00000000-0000-4000-8000-000000000001" : ({ String: "synthetic fixture", Int: 12, Boolean: true, Decimal: "999999999999.99", Bytes: Buffer.from([0, 1, 255]), DateTime: new Date("2026-09-22T00:00:00.000Z"), Json: { $date: "not a BSON date", $binary: { base64: "notbinary" }, nested: [null, 1] } }[field.type]));
    return [key, field.list ? [value] : value];
  }));
}
function document(model: string, patch: Record<string, unknown> = {}) { return encodeMongoDocument(model, { ...row(model), ...patch }, { sourceMode: "plaintext" }); }

test("all 35 models survive actual BSON serialization without scalar or ciphertext loss", () => {
  for (const model of mongoModelNames) {
    const source = document(model);
    const wire = BSON.serialize(canonicalToBson(model, source));
    const result = BSON.deserialize(wire, { promoteBuffers: false });
    assert.deepEqual(bsonToCanonical(model, result), source, model);
  }
  const course = canonicalToBson("Course", document("Course"));
  assert.ok(course.revenue instanceof Decimal128);
  assert.equal(course.revenue.toString(), "999999999999.99");
  assert.ok(course.createdAt instanceof Date);
  const attachment = canonicalToBson("AnnouncementAttachment", document("AnnouncementAttachment"));
  assert.ok(attachment.data instanceof Binary);
});

test("JSON tag-like user content is not reinterpreted as EJSON and null variants stay distinct", () => {
  const input = document("OperationSession");
  const bson = canonicalToBson("OperationSession", input);
  assert.deepEqual(bson.validationErrors, input.validationErrors);
  assert.deepEqual(decodeMongoDocument("OperationSession", bsonToCanonical("OperationSession", BSON.deserialize(BSON.serialize(bson)))).validationErrors, { $date: "not a BSON date", $binary: { base64: "notbinary" }, nested: [null, 1] });
  assert.deepEqual(bsonToCanonical("OperationSession", BSON.deserialize(BSON.serialize(bson))), input);
  for (const value of [Prisma.DbNull, Prisma.JsonNull]) {
    const doc = document("InstructorNote", { notionProfile: value });
    assert.deepEqual(bsonToCanonical("InstructorNote", BSON.deserialize(BSON.serialize(canonicalToBson("InstructorNote", doc)))), doc);
  }
});

test("unknown/missing keys and wrong BSON scalar types fail before accepting target documents", () => {
  const doc = document("Course");
  const bson = canonicalToBson("Course", doc);
  assert.throws(() => bsonToCanonical("Course", { ...bson, unexpected: "secret" }), /INVALID_BSON_FIELDS/);
  const missing = { ...bson }; delete missing.createdAt;
  assert.throws(() => bsonToCanonical("Course", missing), /TARGET_FIELD_COVERAGE/);
  assert.throws(() => bsonToCanonical("Course", { ...bson, revenue: 99.99 }), /INVALID_BSON_DECIMAL/);
  assert.throws(() => bsonToCanonical("Course", { ...bson, createdAt: "2026-09-22" }), /INVALID_BSON_DATE/);
  assert.throws(() => canonicalToBson("Course", { ...doc, extra: 1 } as CanonicalDocument), /TARGET_FIELD_COVERAGE/);
  const attachment = canonicalToBson("AnnouncementAttachment", document("AnnouncementAttachment"));
  assert.throws(() => bsonToCanonical("AnnouncementAttachment", { ...attachment, data: new Binary(Buffer.from([1]), 4) }), /INVALID_BSON_BYTES/);
});

test("shadow target rejects production database construction without issuing operations", () => {
  let calls = 0;
  assert.throws(() => new NativeMongoShadowTarget({ databaseName: "production", collection() { calls++; } } as never), /EXPLICIT_SHADOW_DATABASE_REQUIRED/);
  assert.equal(calls, 0);
});
