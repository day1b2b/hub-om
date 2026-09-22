import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { Prisma } from "@prisma/client";
import { decrypt, encrypt } from "../privacy/crypto";
import { privacyFields } from "../privacy/fields";
import { decodeMongoDocument, encodeMongoDocument, hashMongoDocument, mongoModelContracts, mongoModelNames, mongoSourceId, type CanonicalDocument } from "./mongoDocumentCodec";
const previous = { keys: process.env.PII_ENCRYPTION_KEYS, active: process.env.PII_ACTIVE_KEY_ID, index: process.env.PII_INDEX_KEY };
process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
process.env.PII_ACTIVE_KEY_ID = "fixture";
process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
after(() => { for (const [key, value] of Object.entries({ PII_ENCRYPTION_KEYS: previous.keys, PII_ACTIVE_KEY_ID: previous.active, PII_INDEX_KEY: previous.index })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const uuid = "00000000-0000-4000-8000-000000000001";
function fixture(model: string): Record<string, unknown> {
  const companions = new Set(Object.values(privacyFields[model]?.fields ?? {}).flatMap(policy => [policy.storage, policy.index]));
  return Object.fromEntries(Object.entries(mongoModelContracts[model].fields).filter(([name]) => !companions.has(name)).map(([name, field]) => {
    const value = field.values?.[0] ?? (field.uuid ? uuid : ({ String: "synthetic pii:v1:ordinary user text", Int: 1, Boolean: true, Decimal: "999999999999.99", DateTime: new Date("2026-09-22T00:00:00.000Z"), Bytes: Buffer.from([0, 255, 1]), Json: { nested: [null, "synthetic", { $date: "ordinary-json" }] } }[field.type]));
    return [name, field.list ? [value] : value];
  }));
}
const encode = (name: string, row: Record<string, unknown>) => encodeMongoDocument(name, row, { sourceMode: "plaintext" });

test("all 35 DMMF models and all 125 private fields roundtrip without plaintext persistence", () => {
  assert.equal(mongoModelNames.length, 35);
  let privateFields = 0;
  for (const model of mongoModelNames) {
    const row = fixture(model);
    const doc = encode(model, row);
    assert.equal(doc._id, mongoSourceId(model, row));
    const decoded = decodeMongoDocument(model, doc);
    for (const [key, original] of Object.entries(row)) {
      if (mongoModelContracts[model].fields[key].type === "Decimal") assert.equal(String(decoded[key]), String(original));
      else assert.deepEqual(decoded[key], original, `${model}.${key}`);
    }
    for (const [field, policy] of Object.entries(privacyFields[model]?.fields ?? {})) {
      privateFields++;
      const value = doc[policy.storage ?? field];
      assert.notDeepEqual(value, row[field]);
      if (policy.storage) assert.equal(doc[field], null);
      if (policy.index) assert.match(String(doc[policy.index]), /^[a-f0-9]{64}$/);
    }
    assert.match(hashMongoDocument(model, doc), /^[a-f0-9]{64}$/);
  }
  assert.equal(privateFields, 125);
});

test("Decimal retains exact precision, UUID remains string, bytes and Json tagged values roundtrip", () => {
  const row = fixture("Course");
  row.revenue = new Prisma.Decimal("999999999999.99");
  const doc = encode("Course", row);
  assert.deepEqual(doc.revenue, { $decimal: "999999999999.99" });
  assert.equal(doc._id, uuid);
  for (const invalid of [1.2, "1000000000000.00", "1.001", "1e2"]) assert.throws(() => encode("Course", { ...row, revenue: invalid }));
  assert.throws(() => encode("Course", { ...row, id: "not-a-uuid" }));
  assert.throws(() => encode("Course", { ...row, createdAt: "2026-02-30T00:00:00.000Z" }));
});

test("JSON database NULL differs from JSON null; ambiguous bare null is refused", () => {
  const row = fixture("InstructorNote");
  const sqlNull = encode("InstructorNote", { ...row, notionProfile: Prisma.DbNull });
  const jsonNull = encode("InstructorNote", { ...row, notionProfile: Prisma.JsonNull });
  assert.equal(sqlNull.notionProfile, null);
  assert.notEqual(jsonNull.notionProfile, null);
  assert.equal(decodeMongoDocument("InstructorNote", sqlNull).notionProfile, Prisma.DbNull);
  assert.equal(decodeMongoDocument("InstructorNote", jsonNull).notionProfile, Prisma.JsonNull);
  assert.throws(() => encode("InstructorNote", { ...row, notionProfile: null }), /AMBIGUOUS_JSON_NULL/);
  assert.throws(() => encode("OmRequest", { ...fixture("OmRequest"), sessions: Prisma.DbNull }), /REQUIRED_NULL/);
});

test("explicit plaintext mode encrypts envelope-looking text; encrypted mode authenticates and preserves bytes", () => {
  const row = fixture("TeamUser");
  row.name = encrypt("inner synthetic text", "TeamUser.name");
  const doc = encode("TeamUser", row);
  assert.equal(decrypt(String(doc.name), "TeamUser.name"), row.name);
  const stored = Object.fromEntries(Object.entries(doc).map(([key, value]) => [key === "_id" ? "id" : key, key.endsWith("At") && value && typeof value === "object" ? new Date(String((value as Record<string, unknown>).$date)) : value]));
  assert.deepEqual(encodeMongoDocument("TeamUser", stored, { sourceMode: "encrypted" }), doc);
  assert.throws(() => encodeMongoDocument("TeamUser", row, { sourceMode: "encrypted" }));
  assert.throws(() => encodeMongoDocument("TeamUser", row, undefined as never), /SOURCE_MODE_REQUIRED/);
  const changed = { ...doc, name: encrypt("wrong context", "Coach.name") };
  assert.throws(() => decodeMongoDocument("TeamUser", changed), /AUTHENTICATION/);
  assert.throws(() => decodeMongoDocument("TeamUser", { ...doc, namePiiIndex: "0".repeat(64) }), /INDEX_MISMATCH/);
  const before = process.env.PII_ENCRYPTION_KEYS;
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  try { assert.throws(() => hashMongoDocument("TeamUser", doc), /AUTHENTICATION/); }
  finally { process.env.PII_ENCRYPTION_KEYS = before; }
});

test("date companions conflict fails closed; canonical target unknown/missing/tampered fields rejected", () => {
  const row = fixture("Coach");
  assert.throws(() => encode("Coach", { ...row, returnDateEncrypted: "unexpected" }), /CONFLICTING_DATE_STORAGE/);
  const doc = encode("Coach", row);
  assert.throws(() => decodeMongoDocument("Coach", { ...doc, unexpected: "never print this" }), /TARGET_FIELD_COVERAGE/);
  assert.throws(() => encode("Coach", { ...row, unexpected: "never print this" }), /UNKNOWN_FIELD/);
  const missing = { ...row }; delete missing.name;
  assert.throws(() => encode("Coach", missing), /MISSING_FIELD/);
  assert.throws(() => encode("UnknownModel", row), /UNKNOWN_MODEL/);
  assert.throws(() => decodeMongoDocument("Coach", { ...doc, createdAt: { $date: "bad" } }), /INVALID_DATE/);
  assert.throws(() => decodeMongoDocument("Coach", { ...doc, name: String(doc.name).slice(0, -5) }), /AUTHENTICATION/);
});

test("compound primary keys are reversible and exact hash ignores object key ordering", () => {
  const row = fixture("CoachField");
  row.tagId = "00000000-0000-4000-8000-000000000002";
  const doc = encode("CoachField", row);
  assert.equal(doc._id, `compound:${JSON.stringify([row.coachId, row.tagId])}`);
  assert.deepEqual(decodeMongoDocument("CoachField", doc), row);
  assert.equal(hashMongoDocument("CoachField", doc), hashMongoDocument("CoachField", Object.fromEntries(Object.entries(doc).reverse()) as CanonicalDocument));
  assert.throws(() => decodeMongoDocument("CoachField", { ...doc, _id: "wrong" }), /TARGET_ID_MISMATCH/);
});

test("all model encrypted source documents retain exact ciphertext and lookup companions", () => {
  for (const model of mongoModelNames) {
    const doc = encode(model, fixture(model));
    const stored = Object.fromEntries(Object.entries(mongoModelContracts[model].fields).map(([key, definition]) => {
      const value = doc[key === "id" ? "_id" : key];
      let raw: unknown = value;
      if (definition.list && definition.type === "DateTime" && Array.isArray(value)) raw = value.map(entry => new Date(String((entry as Record<string, unknown>).$date)));
      if (value === null && definition.type === "Json") raw = Prisma.DbNull;
      else if (value && typeof value === "object" && !Array.isArray(value)) {
        if (definition.type === "Json") raw = value.$jsonNull ? Prisma.JsonNull : value.$json;
        if (definition.type === "Bytes") raw = Buffer.from(String(value.$bytes), "base64");
        if (definition.type === "DateTime") raw = new Date(String(value.$date));
        if (definition.type === "Decimal") raw = String(value.$decimal);
      }
      return [key, raw];
    }));
    assert.deepEqual(encodeMongoDocument(model, stored, { sourceMode: "encrypted" }), doc, model);
  }
});

test("enum, cyclic JSON, invalid numbers and swapped date storage fail closed without value leakage", () => {
  assert.throws(() => encode("Coach", { ...fixture("Coach"), status: "SECRET_UNKNOWN_ENUM" }), error => error instanceof Error && /INVALID_ENUM/.test(error.message) && !error.message.includes("SECRET"));
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => encode("InstructorNote", { ...fixture("InstructorNote"), notionProfile: cycle }), /CYCLIC_JSON/);
  for (const value of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => encode("InstructorNote", { ...fixture("InstructorNote"), notionProfile: { value } }), /INVALID_JSON_NUMBER/);
  const doc = encode("Coach", fixture("Coach"));
  assert.throws(() => decodeMongoDocument("Coach", { ...doc, returnDateEncrypted: encrypt("2026-09-22T00:00:00.000Z", "CoachPrivateProfile.birthDate") }), /AUTHENTICATION/);
});

test("all declared FK and unique contracts retain their full model coverage", () => {
  const expectedReferences = Prisma.dmmf.datamodel.models.flatMap(model => model.fields.filter(field => field.kind === "object" && (field as unknown as { relationFromFields?: string[] }).relationFromFields?.length));
  // Prisma7 strips relationFromFields; checked-in public schema is independently counted below.
  assert.ok(expectedReferences.length === 0 || expectedReferences.length === Object.values(mongoModelContracts).flatMap(model => model.references).length);
  assert.equal(Object.values(mongoModelContracts).flatMap(model => model.references).length, 23);
  assert.deepEqual(mongoModelContracts.Course.references, [{ fields: ["companyId"], targetModel: "Company", targetFields: ["id"] }]);
  assert.ok(mongoModelContracts.Member.uniqueKeys.some(key => key.fields.join(",") === "role,sourceTeam,normalizedNamePiiIndex" && key.nullsDistinct));
  assert.equal(mongoModelContracts.Member.uniqueKeys.some(key => key.fields.includes("normalizedName")), false);
});
