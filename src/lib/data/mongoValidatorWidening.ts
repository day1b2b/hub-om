import type { Document } from "mongodb";
import { mongoRuntimeContracts } from "./mongoRuntimeCodec";
import { applyMongoValidator, MongoOperationStore, operationMongoValidator, OPERATION_MODELS, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongo, stableMongoValue } from "./mongoOperationPrimitives";

export interface ValidatorEnumAddition { path: string; values: unknown[] }
export type ValidatorComparison =
  | { kind: "same" }
  | { kind: "widening"; added: ValidatorEnumAddition[] }
  | { kind: "incompatible"; path: string };

/**
 * Compares a stored collection validator with a target validator.
 * Only "the target allows extra enum values" counts as widening: every document the stored validator
 * accepts is still accepted, so applying it cannot reject existing rows. Anything else is incompatible.
 */
export function compareOperationValidator(stored: unknown, target: unknown): ValidatorComparison {
  if (stableMongoValue(stored) === stableMongoValue(target)) return { kind: "same" };
  const added: ValidatorEnumAddition[] = [];
  const mismatch = walk(stored, target, "", added);
  return mismatch === null ? { kind: "widening", added } : { kind: "incompatible", path: mismatch || "/" };
}

function walk(stored: unknown, target: unknown, path: string, added: ValidatorEnumAddition[]): string | null {
  if (Array.isArray(stored) && Array.isArray(target)) {
    if (path.endsWith("/enum")) {
      const kept = new Set(stored.map(stableMongoValue));
      const wanted = new Set(target.map(stableMongoValue));
      if ([...kept].some(value => !wanted.has(value))) return path;
      const extra = target.filter(value => !kept.has(stableMongoValue(value)));
      if (extra.length) added.push({ path, values: extra });
      return null;
    }
    if (stored.length !== target.length) return path;
    for (let i = 0; i < stored.length; i++) {
      const mismatch = walk(stored[i], target[i], `${path}/${i}`, added);
      if (mismatch !== null) return mismatch;
    }
    return null;
  }
  if (isPlainObject(stored) && isPlainObject(target)) {
    const keys = Object.keys(target);
    if (Object.keys(stored).length !== keys.length || keys.some(key => !Object.hasOwn(stored, key))) return path;
    for (const key of keys) {
      const mismatch = walk(stored[key], target[key], `${path}/${key}`, added);
      if (mismatch !== null) return mismatch;
    }
    return null;
  }
  return stableMongoValue(stored) === stableMongoValue(target) ? null : path;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

export interface EnumWidening { model: string; field: string; values: string[] }

/** Parses `Model.field=V1,V2,...`. The list is the complete new value list in the next contract's order. */
export function parseEnumWidening(argument: string): EnumWidening {
  const match = /^([A-Za-z]+)\.([A-Za-z]+)=([A-Z0-9_]+(?:,[A-Z0-9_]+)*)$/.exec(argument);
  assertMongo(match, "INVALID_ENUM_WIDENING");
  return { model: match[1], field: match[2], values: match[3].split(",") };
}

/**
 * The validator the next contract will expect once `field` lists `values`, built from the deployed contract.
 * The order must match the next mongoRuntimeContracts.json exactly, because readiness compares validators verbatim.
 */
export function widenedOperationValidator({ model, field, values }: EnumWidening): Document {
  assertMongo((OPERATION_MODELS as readonly string[]).includes(model), "UNKNOWN_OPERATION_MODEL");
  const definition = mongoRuntimeContracts[model].fields[field];
  assertMongo(definition?.values, "ENUM_FIELD_REQUIRED");
  assertMongo(new Set(values).size === values.length && definition.values.every(value => values.includes(value)) && values.length > definition.values.length, "ENUM_VALUES_NOT_WIDENING");
  const validator = structuredClone(operationMongoValidator(model)) as Document;
  // Models with private blind indexes wrap the shape in $and.
  const schema = (validator.$jsonSchema ?? validator.$and?.[0]?.$jsonSchema) as Document | undefined;
  assertMongo(schema?.properties?.[field]?.enum, "ENUM_FIELD_REQUIRED");
  schema.properties[field].enum = definition.nullable ? [...values, null] : [...values];
  return validator;
}

export interface OperationValidatorStatus {
  model: string;
  collection: string;
  comparison: ValidatorComparison | { kind: "missing" };
  /** True when at least one stored row would be rejected by the target validator. */
  nonconformingSample: boolean;
}

async function inspectOne(store: MongoOperationStore, model: string, target: Document): Promise<OperationValidatorStatus> {
  const collection = store.collection(model);
  const info = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  if (!info) return { model, collection: collection.collectionName, comparison: { kind: "missing" }, nonconformingSample: false };
  const comparison = compareOperationValidator(info.options?.validator ?? {}, target);
  const nonconformingSample = comparison.kind === "same" ? false
    : !!await collection.findOne({ $nor: [target] }, { projection: { _id: 1 }, maxTimeMS: 60_000 });
  return { model, collection: collection.collectionName, comparison, nonconformingSample };
}

/** Read-only. Compares every operation collection with the deployed contract, or one collection with a planned widening. */
export async function inspectOperationValidators(options: MongoOperationOptions, widening?: EnumWidening): Promise<OperationValidatorStatus[]> {
  const store = new MongoOperationStore(options);
  if (widening) return [await inspectOne(store, widening.model, widenedOperationValidator(widening))];
  const result: OperationValidatorStatus[] = [];
  for (const model of OPERATION_MODELS) result.push(await inspectOne(store, model, operationMongoValidator(model)));
  return result;
}

/**
 * Widens one stored validator to the next contract. Refuses before any write unless the stored validator equals
 * the deployed contract (or already equals the target) and no stored row would be rejected.
 * After it succeeds the running code, which still expects the old validator, fails readiness until the next
 * contract is deployed. Run it right before that deploy.
 */
export async function applyEnumWidening(options: MongoOperationOptions & { allowShadowWrites: true }, widening: EnumWidening): Promise<"applied" | "already-applied"> {
  assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
  const store = new MongoOperationStore(options);
  const target = widenedOperationValidator(widening);
  const collection = store.collection(widening.model);
  const read = async () => (await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next())?.options?.validator;
  const stored = await read();
  if (stableMongoValue(stored) === stableMongoValue(target)) return "already-applied";
  assertMongo(stored && stableMongoValue(stored) === stableMongoValue(operationMongoValidator(widening.model)), "STORED_VALIDATOR_NOT_DEPLOYED_CONTRACT");
  assertMongo(compareOperationValidator(stored, target).kind === "widening", "VALIDATOR_CHANGE_NOT_WIDENING");
  await applyMongoValidator(store, widening.model, target);
  assertMongo(stableMongoValue(await read()) === stableMongoValue(target), "VALIDATOR_NOT_APPLIED");
  return "applied";
}

/**
 * Rollback for a widening whose deploy failed: puts the deployed contract's validator back.
 * Only when the stored validator is a widening of it and no stored row uses a value the deployed contract lacks.
 */
export async function restoreDeployedValidator(options: MongoOperationOptions & { allowShadowWrites: true }, model: string): Promise<"restored" | "already-deployed"> {
  assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
  assertMongo((OPERATION_MODELS as readonly string[]).includes(model), "UNKNOWN_OPERATION_MODEL");
  const store = new MongoOperationStore(options);
  const deployed = operationMongoValidator(model);
  const collection = store.collection(model);
  const read = async () => (await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next())?.options?.validator;
  const stored = await read();
  if (stableMongoValue(stored) === stableMongoValue(deployed)) return "already-deployed";
  assertMongo(stored && compareOperationValidator(deployed, stored).kind === "widening", "STORED_VALIDATOR_NOT_WIDENING_OF_DEPLOYED");
  // applyMongoValidator refuses when any stored row would be rejected (e.g. a row already saved with the new value).
  await applyMongoValidator(store, model, deployed);
  assertMongo(stableMongoValue(await read()) === stableMongoValue(deployed), "VALIDATOR_NOT_APPLIED");
  return "restored";
}
