import { createHash } from "node:crypto";
import snapshot from "./operation-transition-manifest.json" with { type: "json" };

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = Record<string, Json>;
type Field = { kind: string; nullable: boolean; array?: boolean; values?: string[]; encrypted?: string; for?: string };
type Model = { collection: string; fields: Record<string, Field>; uniqueKeys: Array<{ fields: string[]; nullsDistinct: boolean }>; queryIndexes: string[][] };
export const transitionManifest = snapshot;
const models: Record<string, Model> = snapshot.models;
const modelNames = Object.keys(models);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const envelope = /^pii:v1:[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$/;

// No row values, IDs, hashes, ciphertext or arbitrary input keys in errors/reports.
export class TransitionError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Transition check failed: ${code}`); this.code = code; }
}
function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new TransitionError(code);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function sameKeys(value: Record<string, unknown>, expected: string[], code: string) {
  requireCondition(Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)), code);
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Validate the checked-in proposal itself, in addition to source contract drift. */
export function assertTransitionManifest(): void {
  requireCondition(snapshot.version === 1 && modelNames.length === 4 && snapshot.deferredModels.length === 31, "MANIFEST_COVERAGE");
  requireCondition(new Set([...modelNames, ...snapshot.deferredModels]).size === 35, "MANIFEST_COVERAGE");
  requireCondition(new Set(Object.values(models).map(model => model.collection)).size === 4, "MANIFEST_COLLECTIONS");
  for (const model of Object.values(models)) {
    requireCondition(model.fields.id?.kind === "uuid" && !model.fields.id.nullable, "MANIFEST_ID");
    requireCondition(model.uniqueKeys.some(key => key.fields.length === 1 && key.fields[0] === "id"), "MANIFEST_ID");
    for (const keys of [...model.uniqueKeys.map(key => key.fields), ...model.queryIndexes]) {
      requireCondition(keys.length && new Set(keys).size === keys.length && keys.every(key => Object.hasOwn(model.fields, key)), "MANIFEST_INDEX");
    }
    for (const field of Object.values(model.fields)) {
      if (field.for) requireCondition(field.kind === "hmac" && model.fields[field.for]?.encrypted === "text", "MANIFEST_HMAC");
    }
  }
}

/** Both inputs are explicitly supplied public source files, never env/DB introspection. */
export function assertTransitionBaseline(schemaText: string, privacyPolicyText: string, runtimeSources: Record<string, string>): void {
  assertTransitionManifest();
  requireCondition(hash(schemaText) === snapshot.sourceSchemaSha256, "SCHEMA_DRIFT");
  requireCondition(hash(privacyPolicyText) === snapshot.privacyPolicySha256, "PRIVACY_POLICY_DRIFT");
  for (const [path, expected] of Object.entries(snapshot.runtimeContractSha256)) {
    requireCondition(typeof runtimeSources[path] === "string" && hash(runtimeSources[path]) === expected, "RUNTIME_CONTRACT_DRIFT");
  }
}

/** Decimal(14,2): no floating point conversion, exponent, implicit rounding or precision loss. */
export function decimal14_2(value: unknown): string {
  requireCondition(typeof value === "string" && /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value), "INVALID_DECIMAL");
  const [whole, fraction = ""] = value.split(".");
  const fixed = `${whole}.${fraction.padEnd(2, "0")}`;
  return fixed === "-0.00" ? "0.00" : fixed;
}
function dateMilliseconds(value: unknown, dateOnly: boolean): string {
  requireCondition(typeof value === "string", "INVALID_DATE");
  const pattern = dateOnly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  requireCondition(pattern.test(value) && !value.startsWith("0000"), "INVALID_DATE");
  const text = dateOnly ? `${value}T00:00:00.000Z` : value;
  const date = new Date(text);
  requireCondition(Number.isFinite(date.getTime()) && date.toISOString() === text, "INVALID_DATE");
  return String(date.getTime());
}
function mapField(field: Field, value: unknown): Json {
  if (value === null) { requireCondition(field.nullable, "REQUIRED_NULL"); return null; }
  if (field.array) {
    requireCondition(Array.isArray(value), "INVALID_ARRAY");
    return value.map(item => mapField({ ...field, array: false, nullable: false }, item));
  }
  if (field.encrypted) {
    const text = field.encrypted === "json" && object(value) ? value.__pii : value;
    if (field.encrypted === "json") {
      requireCondition(object(value), "INVALID_ENCRYPTED_JSON");
      sameKeys(value, ["__pii"], "INVALID_ENCRYPTED_JSON");
    }
    requireCondition(typeof text === "string" && envelope.test(text), "INVALID_ENVELOPE");
    // This is format/copy validation only. No claim of authentication or HMAC correctness.
    return field.encrypted === "json" ? { __pii: text } : text;
  }
  switch (field.kind) {
    case "uuid": requireCondition(typeof value === "string" && uuid.test(value), "INVALID_UUID"); return value;
    case "string": requireCondition(typeof value === "string", "INVALID_STRING"); return value;
    case "hmac": requireCondition(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), "INVALID_HMAC"); return value;
    case "enum": requireCondition(typeof value === "string" && field.values?.includes(value), "INVALID_ENUM"); return value;
    case "int": requireCondition(typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647, "INVALID_INT32"); return { $numberInt: String(value) };
    case "money": return { $numberDecimal: decimal14_2(value) };
    case "date": case "instant": return { $date: { $numberLong: dateMilliseconds(value, field.kind === "date") } };
    default: throw new TransitionError("UNSUPPORTED_FIELD");
  }
}

export type TransitionSource = Record<string, Row[]>;
export type TransitionTarget = Record<string, Row[]>;
function readSource(value: unknown): TransitionSource {
  requireCondition(object(value), "INVALID_DATASET");
  sameKeys(value, modelNames, "MODEL_COVERAGE");
  for (const name of modelNames) {
    const rows = value[name];
    requireCondition(Array.isArray(rows), "INVALID_ROWS");
    // Offline fixture checker, deliberately bounded; not a production streaming importer.
    requireCondition(rows.length <= 10_000, "FIXTURE_TOO_LARGE");
    for (const row of rows) {
      requireCondition(object(row), "INVALID_ROW");
      sameKeys(row, Object.keys(models[name].fields), "FIELD_COVERAGE");
      for (const [field, definition] of Object.entries(models[name].fields)) {
        mapField(definition, row[field]);
        if (definition.for) requireCondition((row[field] === null) === (row[definition.for] === null), "HMAC_NULL_MISMATCH");
      }
    }
  }
  requireCondition(modelNames.some(name => (value[name] as unknown[]).length > 0), "EMPTY_SLICE");
  return value as TransitionSource;
}
function unique(rows: Row[], fields: string[], nullable = false) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (nullable && fields.some(field => row[field] === null)) continue;
    const key = JSON.stringify(fields.map(field => row[field]));
    requireCondition(!seen.has(key), "DUPLICATE_KEY");
    seen.add(key);
  }
}
function validateRelationsAndKeys(source: TransitionSource) {
  for (const name of modelNames) {
    for (const key of models[name].uniqueKeys) unique(source[name], key.fields, key.nullsDistinct);
  }
  const companies = new Set(source.Company.map(row => row.id));
  const courses = new Set(source.Course.map(row => row.id));
  const operations = new Set(source.OperationSession.map(row => row.operationId));
  requireCondition(source.Course.every(row => companies.has(row.companyId)), "ORPHAN_COURSE");
  requireCondition(source.OperationSession.every(row => courses.has(row.courseRecordId)), "ORPHAN_SESSION");
  // CalendarEventLink has no SQL FK; dangling loose joins need review, never silently drop.
  requireCondition(source.CalendarEventLink.every(row => operations.has(row.operationId)), "DANGLING_CALENDAR_LINK");
}

/** Produces an offline EJSON proposal. It does not insert BSON or create a MongoDB client. */
export function mapOperationSlice(input: unknown, sequenceHighWater: unknown): { collections: TransitionTarget; sequenceHighWater: number } {
  assertTransitionManifest();
  const source = readSource(input);
  validateRelationsAndKeys(source);
  requireCondition(typeof sequenceHighWater === "number" && Number.isInteger(sequenceHighWater) && sequenceHighWater >= 0 && sequenceHighWater < 2147483647, "INVALID_SEQUENCE_HIGH_WATER");
  requireCondition(source.Course.every(row => typeof row.processSeq === "number" && row.processSeq > 0 && row.processSeq <= sequenceHighWater), "SEQUENCE_BELOW_EXISTING");
  const collections: TransitionTarget = {};
  for (const name of modelNames) {
    const { collection, fields } = models[name];
    collections[collection] = source[name].map(row => Object.fromEntries(Object.entries(fields).map(([key, field]) => [key === "id" ? "_id" : key, mapField(field, row[key])])));
  }
  return { collections, sequenceHighWater };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  requireCondition(value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)), "INVALID_JSON");
  return JSON.stringify(value);
}

export const unverifiedCutoverGates = [
  "remaining-31-models", "authenticated-ciphertext-and-hmac", "native-driver-and-bson-size", "actual-indexes-and-collation",
  "replica-set-transactions-and-audit-atomicity", "calendar-stale-worker-and-idempotency",
  "sequence-state-export", "backup-restore-and-reverse-migration", "production-volume-and-performance"
] as const;

/** Row order is irrelevant; arrays, all stored fields, exact decimal/date and ciphertext are not. */
export function verifyOperationSlice(input: unknown, target: unknown, sequenceHighWater: unknown) {
  const mapped = mapOperationSlice(input, sequenceHighWater);
  requireCondition(object(target), "INVALID_TARGET");
  sameKeys(target, Object.keys(mapped.collections), "TARGET_COLLECTION_COVERAGE");
  const counts: Record<string, number> = {};
  for (const [collection, expected] of Object.entries(mapped.collections)) {
    const actual = target[collection];
    requireCondition(Array.isArray(actual), "INVALID_TARGET_ROWS");
    requireCondition(actual.length === expected.length, "ROW_COUNT_MISMATCH");
    const indexed = new Map<string, unknown>();
    for (const row of actual) {
      requireCondition(object(row) && typeof row._id === "string" && uuid.test(row._id), "INVALID_TARGET_ID");
      requireCondition(!indexed.has(row._id), "DUPLICATE_TARGET_ID");
      indexed.set(row._id, row);
    }
    for (const row of expected) {
      requireCondition(indexed.has(String(row._id)), "TARGET_ID_SET_MISMATCH");
      requireCondition(canonical(indexed.get(String(row._id))) === canonical(row), "ROW_MISMATCH");
    }
    counts[collection] = actual.length;
  }
  return { equivalent: true, scope: "operation-calendar-fixture", manifestVersion: snapshot.version, manifestSha256: hash(JSON.stringify(snapshot)), counts, readyForCutover: false, unverified: unverifiedCutoverGates };
}
