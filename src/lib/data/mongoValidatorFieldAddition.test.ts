import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { operationMongoIndexes, operationMongoValidator } from "./mongoOperationStore";
import { mongoFailureCode } from "./mongoOperationPrimitives";
import { compareFieldAddition, emitFieldAdditionTarget, parseFieldAdditionTarget } from "./mongoValidatorFieldAddition";
import { stableMongoValue } from "./mongoOperationPrimitives";

type Schema = { required: string[]; properties: Record<string, Record<string, unknown>>; [key: string]: unknown };
type Validator = { $jsonSchema?: Schema; $and?: [{ $jsonSchema: Schema }, ...unknown[]] };
const schemaOf = (validator: unknown): Schema => {
  const shape = validator as Validator;
  return shape.$jsonSchema ?? shape.$and![0].$jsonSchema;
};
const ENVELOPE = "^pii:v1:[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$";
const pair = (a: string, b: string) => ({ $expr: { $eq: [{ $eq: [`$${a}`, null] }, { $eq: [`$${b}`, null] }] } });

const ADDED_FIELDS = ["businessNumber", "businessType", "businessNumberPiiIndex"];

/**
 * The shape #762 gives Company: a plain nullable field plus a private field with its blind index and null pairing.
 * The deployed contract already carries every business-info field (committed alongside this fixture), so the
 * "before widening" validator is built by stripping the three fields back out of it rather than adding them.
 */
function companyAddition(): { deployed: Record<string, unknown>; target: Record<string, unknown> } {
  const target = structuredClone(operationMongoValidator("Company")) as Validator;
  const deployed = structuredClone(target);
  const schema = schemaOf(deployed);
  for (const name of ADDED_FIELDS) {
    delete schema.properties[name];
    schema.required = schema.required.filter(field => field !== name);
  }
  const droppedPair = stableMongoValue(pair("businessNumber", "businessNumberPiiIndex"));
  deployed.$and = deployed.$and!.filter(clause => stableMongoValue(clause) !== droppedPair) as Validator["$and"];
  return { deployed, target };
}

test("nullable fields, their blind indexes and null pairing compare as an addition", () => {
  const { deployed, target } = companyAddition();
  const result = compareFieldAddition(deployed, target);
  assert.equal(result.kind, "addition");
  assert.deepEqual(new Set((result as { fields: string[] }).fields), new Set(ADDED_FIELDS));
  assert.deepEqual(compareFieldAddition(deployed, structuredClone(deployed)), { kind: "same" });
});

test("an addition to a model that already pairs private fields keeps the deployed pairs", () => {
  const deployed = operationMongoValidator("OperationSession") as Validator;
  assert.ok(deployed.$and, "OperationSession carries private blind indexes");
  const target = structuredClone(deployed);
  const schema = target.$and![0].$jsonSchema;
  schema.properties.extraNote = { bsonType: ["string", "null"], pattern: ENVELOPE };
  schema.properties.extraNotePiiIndex = { bsonType: ["string", "null"], pattern: "^[a-f0-9]{64}$" };
  schema.required.push("extraNote", "extraNotePiiIndex");
  target.$and!.push(pair("extraNote", "extraNotePiiIndex"));
  assert.deepEqual(compareFieldAddition(deployed, target), { kind: "addition", fields: ["extraNote", "extraNotePiiIndex"] });

  const dropped = structuredClone(target);
  dropped.$and!.splice(1, 1);
  assert.equal(compareFieldAddition(deployed, dropped).kind, "incompatible");
});

test("anything beyond nullable additions is incompatible", () => {
  const { deployed, target: validTarget } = companyAddition();
  const cases: Array<[string, (validator: Record<string, unknown>) => void]> = [
    ["field that rejects null", v => { schemaOf(v).properties.businessType = { bsonType: "string" }; }],
    ["enum without null", v => { schemaOf(v).properties.businessType = { bsonType: ["string", "null"], enum: ["A"] }; }],
    ["added field not required", v => { schemaOf(v).required = schemaOf(v).required.filter(name => name !== "businessType"); }],
    ["deployed field changed", v => { schemaOf(v).properties.name = { bsonType: ["string", "null"] }; }],
    ["deployed field removed", v => { delete schemaOf(v).properties.normalizedName; schemaOf(v).required = schemaOf(v).required.filter(name => name !== "normalizedName"); }],
    ["additionalProperties opened", v => { schemaOf(v).additionalProperties = true; }],
    ["pairing a deployed field", v => { (v.$and as unknown[]).push(pair("name", "businessType")); }],
    ["unknown rule", v => { (v.$and as unknown[]).push({ $expr: { $gt: ["$createdAt", null] } }); }]
  ];
  for (const [label, mutate] of cases) {
    const target = structuredClone(validTarget);
    mutate(target);
    assert.equal(compareFieldAddition(deployed, target).kind, "incompatible", label);
  }
  assert.equal(compareFieldAddition(deployed, {}).kind, "incompatible");
  assert.equal(compareFieldAddition(deployed, undefined).kind, "incompatible");
  // The reverse direction (a removal) is never an addition.
  assert.equal(compareFieldAddition(validTarget, deployed).kind, "incompatible");
});

test("the emitted token round-trips the build's validator and indexes with a stable digest", () => {
  const emitted = emitFieldAdditionTarget("Company");
  assert.match(emitted.token, /^[A-Za-z0-9_-]+$/);
  assert.match(emitted.digest, /^[a-f0-9]{16}$/);
  const parsed = parseFieldAdditionTarget(emitted.token);
  assert.deepEqual(parsed, { model: "Company", validator: operationMongoValidator("Company"), indexes: operationMongoIndexes("Company"), digest: emitted.digest });
  assert.equal(emitFieldAdditionTarget("Company").digest, emitted.digest);
  assert.notEqual(emitFieldAdditionTarget("Course").digest, emitted.digest);
});

test("malformed tokens and unknown models are refused with fixed codes", () => {
  const encode = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value))).toString("base64url");
  const valid = { v: 1, model: "Company", validator: operationMongoValidator("Company"), indexes: [] };
  const index = { name: "runtime_pii_x", key: { x: 1 } };
  const badIndexes = [[{ key: { a: 1 } }], [{ ...index, expireAfterSeconds: 1 }], [{ ...index, sparse: true }], [{ ...index, hidden: true }], [{ ...index, key: { x: "text" } }], [{ ...index, unique: "yes" }]];
  for (const token of ["", "not base64!", "AAAAAAAAAAAAAAAAAAAA", encode({ ...valid, v: 2 }), encode({ ...valid, validator: [] }), ...badIndexes.map(indexes => encode({ ...valid, indexes }))]) {
    assert.throws(() => parseFieldAdditionTarget(token), (error: unknown) => mongoFailureCode(error) === "INVALID_FIELD_ADDITION_TOKEN", token.slice(0, 20));
  }
  assert.throws(() => parseFieldAdditionTarget(encode({ ...valid, model: "CoachProfile" })), (error: unknown) => mongoFailureCode(error) === "UNKNOWN_OPERATION_MODEL");
  assert.throws(() => emitFieldAdditionTarget("CoachProfile"), (error: unknown) => mongoFailureCode(error) === "UNKNOWN_OPERATION_MODEL");
});
