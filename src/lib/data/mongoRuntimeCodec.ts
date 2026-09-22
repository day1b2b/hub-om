/** Runtime BSON contract: no Prisma, schema reads, database connection, or migration imports.
 * Contracts are a checked-in snapshot; tests compare every field with the migration contract.
 */
import { Binary, Decimal128, type Document } from "mongodb";
import contracts from "./mongoRuntimeContracts.json" with { type: "json" };
import policies from "../privacy/fields.json" with { type: "json" };
import { blindIndex, decrypt, encrypt, isEncrypted } from "../privacy/crypto";

type Field = { type: string; nullable: boolean; list: boolean; uuid: boolean; dateOnly: boolean; values?: string[] };
type Model = { collection: string; primaryKey: string[]; fields: Record<string, Field>; references: { fields: string[]; targetModel: string; targetFields: string[] }[]; uniqueKeys: { fields: string[]; nullsDistinct: boolean }[] };
type Policy = { type: string; nullable: boolean; storage?: string; index?: string };
const privacy = policies as Record<string, { fields: Record<string, Policy> }>;
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.freeze(value); for (const item of Object.values(value)) freeze(item); }
  return value;
}
export const mongoRuntimeContracts: Readonly<Record<string, Model>> = freeze(contracts as Record<string, Model>);
export const mongoRuntimeModelNames = Object.freeze(Object.keys(mongoRuntimeContracts));
/** SQL NULL and JSON null remain distinct at the repository boundary. Never persist these symbols. */
export const MongoDbNull = Symbol("MongoDbNull");
export const MongoJsonNull = Symbol("MongoJsonNull");
export type MongoRuntimeDocument = Document & { _id: string };
export class MongoRuntimeCodecError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Mongo runtime validation failed: ${code}`); this.code = code; }
}
function check(value: unknown, code: string): asserts value { if (!value) throw new MongoRuntimeCodecError(code); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
function model(name: string): Model {
  check(Object.hasOwn(mongoRuntimeContracts, name), "UNKNOWN_MODEL");
  return mongoRuntimeContracts[name];
}
function safe<T>(action: () => T): T {
  try { return action(); }
  catch (error) { if (error instanceof MongoRuntimeCodecError) throw error; throw new MongoRuntimeCodecError("INVALID_VALUE_OR_AUTHENTICATION"); }
}
function decimal(value: unknown): string {
  check(typeof value === "string" && /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value), "INVALID_DECIMAL");
  const [whole, fraction = ""] = value.split(".");
  const fixed = `${whole}.${fraction.padEnd(2, "0")}`;
  return fixed === "-0.00" ? "0.00" : fixed;
}
function json(value: unknown, ancestors = new Set<unknown>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { check(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)), "INVALID_JSON_NUMBER"); return value; }
  check(!ancestors.has(value), "CYCLIC_JSON");
  check(Array.isArray(value) || object(value), "INVALID_JSON");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      check(Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean), "INVALID_JSON");
      return value.map(entry => json(entry, ancestors));
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, json(entry, ancestors)]));
  } finally { ancestors.delete(value); }
}
function date(field: Field, value: unknown): Date {
  check(value instanceof Date || typeof value === "string", "INVALID_DATE");
  const text = value instanceof Date ? value.toISOString() : value;
  const result = new Date(text);
  check(Number.isFinite(result.getTime()) && result.toISOString() === text && (!field.dateOnly || text.endsWith("T00:00:00.000Z")), "INVALID_DATE");
  return result;
}
function toBson(field: Field, value: unknown): unknown {
  if (field.type === "Json" && !field.list) {
    if (value === MongoDbNull) { check(field.nullable, "REQUIRED_NULL"); return null; }
    if (value === MongoJsonNull) return { $jsonNull: true };
    check(value !== null, "AMBIGUOUS_JSON_NULL");
    return { $json: json(value) };
  }
  if (value === null) { check(field.nullable, "REQUIRED_NULL"); return null; }
  if (field.list) { check(Array.isArray(value) && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean), "INVALID_LIST"); return value.map(entry => toBson({ ...field, list: false, nullable: false }, entry)); }
  if (field.values) { check(typeof value === "string" && field.values.includes(value), "INVALID_ENUM"); return value; }
  switch (field.type) {
    case "String": check(typeof value === "string" && (!field.uuid || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)), "INVALID_STRING"); return value;
    case "Int": check(typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647, "INVALID_INT32"); return value;
    case "Boolean": check(typeof value === "boolean", "INVALID_BOOLEAN"); return value;
    case "Decimal": return Decimal128.fromString(decimal(value));
    case "Bytes": check(value instanceof Uint8Array, "INVALID_BYTES"); return new Binary(Buffer.from(value));
    case "DateTime": return date(field, value);
    default: throw new MongoRuntimeCodecError("UNSUPPORTED_SCALAR");
  }
}
function fromBson(field: Field, value: unknown): unknown {
  if (value === null) { check(field.nullable, "REQUIRED_NULL"); return field.type === "Json" ? MongoDbNull : null; }
  if (field.list) { check(Array.isArray(value) && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean), "INVALID_LIST"); return value.map(entry => fromBson({ ...field, list: false, nullable: false }, entry)); }
  if (field.type === "DateTime") { check(value instanceof Date, "INVALID_BSON_DATE"); return date(field, value); }
  if (field.type === "Decimal") { check(value instanceof Decimal128, "INVALID_BSON_DECIMAL"); return decimal(value.toString()); }
  if (field.type === "Bytes") { check(value instanceof Binary && value.sub_type === 0, "INVALID_BSON_BYTES"); return Buffer.from(value.value()); }
  if (field.type === "Json") {
    check(object(value) && Object.keys(value).length === 1, "INVALID_JSON_TAG");
    if (Object.hasOwn(value, "$jsonNull")) { check(value.$jsonNull === true, "INVALID_JSON_TAG"); return MongoJsonNull; }
    check(Object.hasOwn(value, "$json") && value.$json !== null, "INVALID_JSON_TAG");
    return json(value.$json);
  }
  toBson(field, value);
  return value;
}
const context = (name: string, field: string) => `${name}.${field}`;
export function mongoRuntimeBlindIndex(name: string, field: string, value: unknown): string | null {
  return safe(() => {
    const definition = model(name).fields[field];
    check(definition && privacy[name]?.fields[field]?.index, "NOT_INDEXED_PRIVATE_FIELD");
    toBson(definition, value);
    return value === null ? null : blindIndex(String(value), context(name, field));
  });
}
function encryptedValue(name: string, field: string, policy: Policy, value: unknown): unknown {
  if (value === null || value === MongoDbNull) return value;
  const aad = context(name, field);
  if (policy.type === "Json") return { __pii: encrypt(JSON.stringify(value === MongoJsonNull ? null : value), aad) };
  if (policy.type === "Bytes") return Buffer.from(encrypt(Buffer.from(value as Uint8Array).toString("base64"), aad));
  if (policy.type === "DateTime") return encrypt(new Date(value as string | Date).toISOString(), aad);
  check(typeof value === "string", "INVALID_PRIVATE_STRING");
  return encrypt(value, aad);
}
function decryptedValue(name: string, field: string, policy: Policy, value: unknown): unknown {
  if (value === null || value === MongoDbNull) { check(policy.nullable, "REQUIRED_NULL"); return value; }
  const aad = context(name, field);
  if (policy.type === "Json") {
    check(object(value) && Object.keys(value).length === 1 && isEncrypted(value.__pii), "INVALID_ENCRYPTED_JSON");
    const plain: unknown = JSON.parse(decrypt(value.__pii, aad));
    return plain === null ? MongoJsonNull : plain;
  }
  const text = policy.type === "Bytes" ? Buffer.from(value as Uint8Array).toString() : value;
  check(isEncrypted(text), "PLAINTEXT_IN_ENCRYPTED_SOURCE");
  const plain = decrypt(text, aad);
  if (policy.type === "DateTime") return new Date(plain);
  if (policy.type === "Bytes") {
    check(Buffer.from(plain, "base64").toString("base64") === plain, "INVALID_BYTES");
    return Buffer.from(plain, "base64");
  }
  return plain;
}
export function mongoRuntimeSourceId(name: string, row: Record<string, unknown>): string {
  return safe(() => {
    const contract = model(name);
    const parts = contract.primaryKey.map(key => toBson(contract.fields[key], row[key]));
    return parts.length === 1 ? String(parts[0]) : `compound:${JSON.stringify(parts)}`;
  });
}
/** Full plaintext logical row only; companion fields may be omitted, but never silently trusted.
 * Encrypts even envelope-looking strings. Decimal inputs are exact strings, not JS numbers.
 */
export function encodeMongoRuntimeDocument(name: string, row: Record<string, unknown>): MongoRuntimeDocument {
  return safe(() => {
    const contract = model(name);
    check(object(row), "INVALID_ROW");
    const privateFields = privacy[name]?.fields ?? {};
    const companions = new Set(Object.values(privateFields).flatMap(policy => [policy.storage, policy.index].filter((item): item is string => Boolean(item))));
    check(Object.keys(row).every(key => Object.hasOwn(contract.fields, key)), "UNKNOWN_FIELD");
    check(Object.keys(contract.fields).every(key => Object.hasOwn(row, key) || companions.has(key)), "MISSING_FIELD");
    const stored = { ...row };
    for (const [field, policy] of Object.entries(privateFields)) {
      const plain = row[field];
      toBson(contract.fields[field], plain);
      if (policy.storage) check(row[policy.storage] == null, "CONFLICTING_DATE_STORAGE");
      stored[policy.storage ?? field] = encryptedValue(name, field, policy, plain);
      if (policy.storage) stored[field] = null;
      if (policy.index) {
        const expected = mongoRuntimeBlindIndex(name, field, plain);
        if (row[policy.index] != null) check(row[policy.index] === expected, "INDEX_MISMATCH");
        stored[policy.index] = expected;
      }
    }
    const document = Object.fromEntries(Object.entries(contract.fields).map(([key, field]) => [key === "id" ? "_id" : key, toBson(field, stored[key])]));
    document._id = mongoRuntimeSourceId(name, stored);
    return document as MongoRuntimeDocument;
  });
}
/** Complete BSON document only. Missing projected PII or companion fields are an error.
 * Callers project logical fields AFTER authentication; never decode an incomplete DB projection.
 */
export function decodeMongoRuntimeDocument(name: string, document: Document): Record<string, unknown> {
  return safe(() => {
    const contract = model(name);
    const keys = Object.keys(contract.fields).map(key => key === "id" ? "_id" : key);
    if (!contract.fields.id) keys.push("_id");
    check(object(document) && Object.keys(document).length === keys.length && keys.every(key => Object.hasOwn(document, key)), "TARGET_FIELD_COVERAGE");
    const stored = Object.fromEntries(Object.entries(contract.fields).map(([key, field]) => [key, fromBson(field, document[key === "id" ? "_id" : key])]));
    check(document._id === mongoRuntimeSourceId(name, stored), "TARGET_ID_MISMATCH");
    const plain = { ...stored };
    for (const [field, policy] of Object.entries(privacy[name]?.fields ?? {})) {
      if (policy.storage) check(stored[field] === null, "CONFLICTING_DATE_STORAGE");
      const value = decryptedValue(name, field, policy, stored[policy.storage ?? field]);
      toBson(contract.fields[field], value);
      if (policy.index) check(stored[policy.index] === mongoRuntimeBlindIndex(name, field, value), "INDEX_MISMATCH");
      plain[field] = value;
      if (policy.storage) plain[policy.storage] = null;
    }
    return plain;
  });
}
