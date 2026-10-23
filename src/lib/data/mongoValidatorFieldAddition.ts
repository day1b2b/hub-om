import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Document, IndexDescription } from "mongodb";
import { MongoOperationStore, operationMongoIndexes, operationMongoValidator, OPERATION_MODELS, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongo, MongoOperationError, stableMongoValue } from "./mongoOperationPrimitives";

/**
 * Nullable field additions to one operation collection (e.g. #762 adding business info fields to Company).
 * The running build only knows the deployed contract, so the next build's validator and indexes travel as a
 * one-line token made by `--emit-field-addition` from the next build. The token is accepted only when it is an
 * additive, null-accepting extension of the deployed validator. Procedure: docs/operations/mongodb-operation-validator-change.md
 */
export type FieldAdditionComparison =
  | { kind: "same" }
  | { kind: "addition"; fields: string[] }
  | { kind: "incompatible"; path: string };

interface SplitValidator { schema: Record<string, unknown>; pairs: unknown[] }

/** Models with private blind indexes wrap the shape in $and with one null-pairing $expr per index. */
function split(validator: unknown): SplitValidator | null {
  if (!isPlainObject(validator)) return null;
  const keys = Object.keys(validator);
  if (keys.length === 1 && keys[0] === "$jsonSchema" && isPlainObject(validator.$jsonSchema)) return { schema: validator.$jsonSchema, pairs: [] };
  if (keys.length !== 1 || keys[0] !== "$and" || !Array.isArray(validator.$and) || validator.$and.length < 2) return null;
  const [first, ...pairs] = validator.$and;
  if (!isPlainObject(first) || Object.keys(first).length !== 1 || !isPlainObject(first.$jsonSchema)) return null;
  return { schema: first.$jsonSchema, pairs };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/** Existing documents get `null` for every added field, so each added property must accept null. */
function acceptsNull(schema: unknown): boolean {
  if (!isPlainObject(schema)) return false;
  if (Array.isArray(schema.oneOf)) return schema.oneOf.some(item => isPlainObject(item) && Object.keys(item).length === 1 && item.bsonType === "null");
  const types = Array.isArray(schema.bsonType) ? schema.bsonType : [schema.bsonType];
  if (!types.includes("null")) return false;
  return !Array.isArray(schema.enum) || schema.enum.includes(null);
}

/** `{ $expr: { $eq: [{ $eq: ["$a", null] }, { $eq: ["$b", null] }] } }` → ["a", "b"], anything else → null. */
function pairFields(pair: unknown): [string, string] | null {
  const side = (value: unknown): string | null => {
    if (!isPlainObject(value) || Object.keys(value).length !== 1 || !Array.isArray(value.$eq) || value.$eq.length !== 2) return null;
    const [field, nothing] = value.$eq;
    return typeof field === "string" && /^\$[A-Za-z0-9_]+$/.test(field) && nothing === null ? field.slice(1) : null;
  };
  if (!isPlainObject(pair) || Object.keys(pair).length !== 1 || !isPlainObject(pair.$expr) || Object.keys(pair.$expr).length !== 1) return null;
  const sides = pair.$expr.$eq;
  if (!Array.isArray(sides) || sides.length !== 2) return null;
  const [a, b] = [side(sides[0]), side(sides[1])];
  return a && b ? [a, b] : null;
}

/**
 * Compares the deployed validator with a target. "addition" means the target only adds properties that accept null
 * (listed in `required`) and null-pairing rules between added fields, so a document the deployed validator accepts
 * is accepted by the target once every added field is set to null. Anything else is incompatible.
 */
export function compareFieldAddition(deployed: unknown, target: unknown): FieldAdditionComparison {
  if (stableMongoValue(deployed) === stableMongoValue(target)) return { kind: "same" };
  const before = split(deployed), after = split(target);
  if (!before || !after) return { kind: "incompatible", path: "/" };
  const schemaKeys = Object.keys(after.schema);
  if (Object.keys(before.schema).length !== schemaKeys.length || schemaKeys.some(key => !Object.hasOwn(before.schema, key))) return { kind: "incompatible", path: "/$jsonSchema" };
  for (const key of schemaKeys) {
    if (key === "properties" || key === "required") continue;
    if (stableMongoValue(before.schema[key]) !== stableMongoValue(after.schema[key])) return { kind: "incompatible", path: `/$jsonSchema/${key}` };
  }
  if (after.schema.additionalProperties !== false) return { kind: "incompatible", path: "/$jsonSchema/additionalProperties" };
  const oldProperties = before.schema.properties, newProperties = after.schema.properties;
  if (!isPlainObject(oldProperties) || !isPlainObject(newProperties)) return { kind: "incompatible", path: "/$jsonSchema/properties" };
  for (const [name, schema] of Object.entries(oldProperties)) {
    if (!Object.hasOwn(newProperties, name) || stableMongoValue(schema) !== stableMongoValue(newProperties[name])) return { kind: "incompatible", path: `/$jsonSchema/properties/${name}` };
  }
  const fields = Object.keys(newProperties).filter(name => !Object.hasOwn(oldProperties, name));
  for (const name of fields) {
    if (name.startsWith("$") || name.includes(".") || !acceptsNull(newProperties[name])) return { kind: "incompatible", path: `/$jsonSchema/properties/${name}` };
  }
  const oldRequired = before.schema.required, newRequired = after.schema.required;
  if (!Array.isArray(oldRequired) || !Array.isArray(newRequired) || new Set(newRequired).size !== newRequired.length
    || stableMongoValue([...newRequired].sort()) !== stableMongoValue([...oldRequired, ...fields].sort())) return { kind: "incompatible", path: "/$jsonSchema/required" };
  const remaining = after.pairs.map(stableMongoValue);
  for (const pair of before.pairs) {
    const index = remaining.indexOf(stableMongoValue(pair));
    if (index < 0) return { kind: "incompatible", path: "/$and" };
    remaining.splice(index, 1);
  }
  const added = new Set(fields);
  for (const pair of after.pairs) {
    if (before.pairs.some(old => stableMongoValue(old) === stableMongoValue(pair))) continue;
    const names = pairFields(pair);
    if (!names || !names.every(name => added.has(name))) return { kind: "incompatible", path: "/$and" };
  }
  if (!fields.length) return { kind: "incompatible", path: "/" };
  return { kind: "addition", fields };
}

export interface FieldAdditionTarget { model: string; validator: Document; indexes: IndexDescription[]; digest: string }

function digestOf(model: string, validator: Document, indexes: IndexDescription[]): string {
  return createHash("sha256").update(stableMongoValue({ model, validator, indexes })).digest("hex").slice(0, 16);
}

export function encodeFieldAdditionTarget(model: string, validator: Document, indexes: IndexDescription[]): { model: string; digest: string; token: string } {
  assertMongo((OPERATION_MODELS as readonly string[]).includes(model), "UNKNOWN_OPERATION_MODEL");
  const token = gzipSync(Buffer.from(JSON.stringify({ v: 1, model, validator, indexes }))).toString("base64url");
  return { model, digest: digestOf(model, validator, indexes), token };
}

/** Run from the build that carries the next contract. Needs no database. */
export function emitFieldAdditionTarget(model: string): { model: string; digest: string; token: string } {
  assertMongo((OPERATION_MODELS as readonly string[]).includes(model), "UNKNOWN_OPERATION_MODEL");
  return encodeFieldAdditionTarget(model, operationMongoValidator(model), operationMongoIndexes(model));
}

const INDEX_KEYS = new Set(["name", "key", "unique", "partialFilterExpression"]);

export function parseFieldAdditionTarget(token: string): FieldAdditionTarget {
  let parsed: unknown;
  try {
    assertMongo(/^[A-Za-z0-9_-]{16,20000}$/.test(token), "INVALID_FIELD_ADDITION_TOKEN");
    parsed = JSON.parse(gunzipSync(Buffer.from(token, "base64url"), { maxOutputLength: 1_000_000 }).toString("utf8"));
  } catch {
    throw new MongoOperationError("INVALID_FIELD_ADDITION_TOKEN");
  }
  // Only the index options the runtime itself declares; TTL, sparse or hidden options would never come from a contract.
  assertMongo(isPlainObject(parsed) && parsed.v === 1 && typeof parsed.model === "string" && isPlainObject(parsed.validator) && Array.isArray(parsed.indexes)
    && parsed.indexes.every(index => isPlainObject(index) && Object.keys(index).every(key => INDEX_KEYS.has(key)) && typeof index.name === "string"
      && isPlainObject(index.key) && Object.values(index.key).every(direction => direction === 1 || direction === -1)
      && (index.unique === undefined || typeof index.unique === "boolean") && (index.partialFilterExpression === undefined || isPlainObject(index.partialFilterExpression))), "INVALID_FIELD_ADDITION_TOKEN");
  const { model, validator, indexes } = parsed as { model: string; validator: Document; indexes: IndexDescription[] };
  assertMongo((OPERATION_MODELS as readonly string[]).includes(model), "UNKNOWN_OPERATION_MODEL");
  return { model, validator, indexes, digest: digestOf(model, validator, indexes) };
}

async function storedOptions(store: MongoOperationStore, model: string): Promise<Document | undefined> {
  const collection = store.collection(model);
  return (await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next())?.options;
}

const missingAny = (fields: string[]) => ({ $or: fields.map(field => ({ [field]: { $exists: false } })) });
const valuedAny = (fields: string[]) => ({ $or: fields.map(field => ({ [field]: { $exists: true, $ne: null } })) });
const strictly = (options: Document | undefined, validator: Document) =>
  options?.validationLevel === "strict" && options?.validationAction === "error" && stableMongoValue(options?.validator) === stableMongoValue(validator);

/**
 * The target keeps every deployed index unchanged; indexes it adds may only key added fields, so creating them cannot
 * touch how the running build reads or writes. Returns the ones still missing, compared the way readiness compares them.
 */
async function missingIndexes(store: MongoOperationStore, model: string, wanted: IndexDescription[], fields: string[]): Promise<IndexDescription[]> {
  const deployed = operationMongoIndexes(model);
  for (const index of deployed) assertMongo(wanted.some(item => stableMongoValue(item) === stableMongoValue(index) && JSON.stringify(item.key) === JSON.stringify(index.key)), "FIELD_ADDITION_INDEX_NOT_ALLOWED");
  for (const index of wanted) {
    if (deployed.some(item => item.name === index.name)) continue;
    assertMongo(!index.unique && Object.keys(index.key).every(key => fields.includes(key)), "FIELD_ADDITION_INDEX_NOT_ALLOWED");
  }
  const existing = await store.collection(model).listIndexes().toArray();
  return wanted.filter(index => {
    const found = existing.find(item => item.name === index.name);
    assertMongo(!found || (JSON.stringify(found.key) === JSON.stringify(index.key) && !!found.unique === !!index.unique
      && stableMongoValue(found.partialFilterExpression) === stableMongoValue(index.partialFilterExpression)
      && !found.sparse && !found.hidden && (!found.collation || found.collation.locale === "simple")), "FIELD_ADDITION_INDEX_CONFLICT");
    return !found;
  });
}

export interface FieldAdditionPlan {
  model: string;
  digest: string;
  state: "ready" | "applied" | "partially-applied";
  fields: string[];
  /** Documents that still lack at least one added field and get null for it. */
  documentsToFill: number;
  indexesToCreate: string[];
  /** True when a stored document would be rejected by the target even after the fill. Apply refuses then. */
  nonconformingSample: boolean;
}

/** Read-only. Refuses unless the target is an addition to the deployed contract and the stored validator is one of the two. */
export async function inspectFieldAddition(options: MongoOperationOptions, target: FieldAdditionTarget): Promise<FieldAdditionPlan> {
  const store = new MongoOperationStore(options);
  const comparison = compareFieldAddition(operationMongoValidator(target.model), target.validator);
  assertMongo(comparison.kind === "addition", "VALIDATOR_CHANGE_NOT_FIELD_ADDITION");
  const stored = await storedOptions(store, target.model);
  const switched = strictly(stored, target.validator);
  assertMongo(switched || strictly(stored, operationMongoValidator(target.model)), "STORED_VALIDATOR_NOT_DEPLOYED_CONTRACT");
  const collection = store.collection(target.model);
  const documentsToFill = await collection.countDocuments(missingAny(comparison.fields), { maxTimeMS: 60_000 });
  const indexesToCreate = (await missingIndexes(store, target.model, target.indexes, comparison.fields)).map(index => index.name!);
  // Checked on the stored rows themselves: what each row becomes after the fill must pass the target.
  const rejected = await collection.aggregate([{ $set: fillOf(comparison.fields) }, { $match: { $nor: [target.validator] } }, { $limit: 1 }, { $project: { _id: 1 } }], { maxTimeMS: 60_000 }).toArray();
  const state = switched ? (documentsToFill || indexesToCreate.length ? "partially-applied" : "applied") : "ready";
  return { model: target.model, digest: target.digest, state, fields: comparison.fields, documentsToFill, indexesToCreate, nonconformingSample: rejected.length > 0 };
}

/** Sets every missing added field to null in one update per document: under the strict target a partial fill is rejected. */
const fillOf = (fields: string[]) => Object.fromEntries(fields.map(field => [field, { $ifNull: [`$${field}`, null] }]));

/**
 * Creates the target's missing indexes, switches the validator, then sets every added field to null on documents that
 * lack it. Idempotent: a run that stopped midway can be repeated. The running build fails readiness from the validator
 * switch until the next contract is deployed, so run it right before that deploy.
 */
export async function applyFieldAddition(options: MongoOperationOptions & { allowShadowWrites: true }, target: FieldAdditionTarget): Promise<{ outcome: "applied" | "already-applied"; filled: number; indexesCreated: string[] }> {
  assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
  const plan = await inspectFieldAddition(options, target);
  assertMongo(!plan.nonconformingSample, "EXISTING_DOCUMENTS_POLICY_MISMATCH");
  if (plan.state === "applied") return { outcome: "already-applied", filled: 0, indexesCreated: [] };
  const store = new MongoOperationStore(options);
  const collection = store.collection(target.model);
  const indexes = await missingIndexes(store, target.model, target.indexes, plan.fields);
  if (indexes.length) await collection.createIndexes(indexes, { collation: { locale: "simple" } });
  if (plan.state === "ready") await store.db.command({ collMod: collection.collectionName, validator: target.validator, validationLevel: "strict", validationAction: "error" });
  const { modifiedCount } = await collection.updateMany(missingAny(plan.fields), [{ $set: fillOf(plan.fields) }]);
  assertMongo(strictly(await storedOptions(store, target.model), target.validator), "VALIDATOR_NOT_APPLIED");
  assertMongo(!await collection.findOne({ $nor: [target.validator] }, { projection: { _id: 1 }, maxTimeMS: 60_000 }), "EXISTING_DOCUMENTS_POLICY_MISMATCH");
  return { outcome: "applied", filled: modifiedCount, indexesCreated: indexes.map(index => index.name!) };
}

/** Read-only. True when the stored validator of `model` is a field addition on top of the deployed contract. */
export async function storedValidatorIsFieldAddition(options: MongoOperationOptions, model: string): Promise<boolean> {
  assertMongo((OPERATION_MODELS as readonly string[]).includes(model), "UNKNOWN_OPERATION_MODEL");
  const stored = await storedOptions(new MongoOperationStore(options), model);
  return compareFieldAddition(operationMongoValidator(model), stored?.validator).kind === "addition";
}

/**
 * Rollback for a field addition whose deploy failed, run from the build being returned to: removes the added fields,
 * then puts the deployed validator back. The fields go first (bypassing the stored validator, which requires them) so that
 * an interrupted run still shows the addition and can be repeated: the deployed build cannot read rows with fields it
 * does not know. Only rows whose added fields are all null are touched; a non-null value is never deleted and stops the
 * run. Indexes the addition created stay; the deployed build ignores indexes it does not expect.
 */
export async function restoreFieldAddition(options: MongoOperationOptions & { allowShadowWrites: true }, model: string): Promise<{ outcome: "restored" | "already-deployed"; fields: string[]; cleared: number }> {
  assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
  assertMongo((OPERATION_MODELS as readonly string[]).includes(model), "UNKNOWN_OPERATION_MODEL");
  const store = new MongoOperationStore(options);
  const deployed = operationMongoValidator(model);
  const collection = store.collection(model);
  const stored = await storedOptions(store, model);
  if (strictly(stored, deployed)) {
    assertMongo(!await collection.findOne({ $nor: [deployed] }, { projection: { _id: 1 }, maxTimeMS: 60_000 }), "EXISTING_DOCUMENTS_POLICY_MISMATCH");
    return { outcome: "already-deployed", fields: [], cleared: 0 };
  }
  const comparison = compareFieldAddition(deployed, stored?.validator);
  assertMongo(comparison.kind === "addition", "STORED_VALIDATOR_NOT_FIELD_ADDITION_OF_DEPLOYED");
  const { fields } = comparison;
  assertMongo(!await collection.findOne(valuedAny(fields), { projection: { _id: 1 }, maxTimeMS: 60_000 }), "FIELD_ADDITION_HAS_VALUES");
  const allNull = { $and: [{ $or: fields.map(field => ({ [field]: { $exists: true } })) }, ...fields.map(field => ({ [field]: null }))] };
  const { modifiedCount } = await collection.updateMany(allNull, { $unset: Object.fromEntries(fields.map(field => [field, ""])) }, { bypassDocumentValidation: true });
  // A value written between the check and the unset stays where it is; stop before the validator switch.
  assertMongo(!await collection.findOne(valuedAny(fields), { projection: { _id: 1 }, maxTimeMS: 60_000 }), "FIELD_ADDITION_HAS_VALUES");
  await store.db.command({ collMod: collection.collectionName, validator: deployed, validationLevel: "strict", validationAction: "error" });
  assertMongo(strictly(await storedOptions(store, model), deployed), "VALIDATOR_NOT_APPLIED");
  assertMongo(!await collection.findOne({ $nor: [deployed] }, { projection: { _id: 1 }, maxTimeMS: 60_000 }), "EXISTING_DOCUMENTS_POLICY_MISMATCH");
  return { outcome: "restored", fields, cleared: modifiedCount };
}
