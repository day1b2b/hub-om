/** Migration/verification tool only: reads the public Prisma schema, never env files or databases. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { decryptField, encryptField, indexField, privacyFields, storedEncrypted } from "../privacy/fields";
import { decimal14_2 } from "./operationTransition";

export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };
export type CanonicalDocument = Record<string, CanonicalValue> & { _id: string };
export type MongoFieldContract = { type: string; nullable: boolean; list: boolean; uuid: boolean; dateOnly: boolean; values?: string[] };
export type MongoModelContract = { collection: string; primaryKey: string[]; fields: Record<string, MongoFieldContract>; references: { fields: string[]; targetModel: string; targetFields: string[] }[]; uniqueKeys: { fields: string[]; nullsDistinct: boolean }[] };
export class MongoCodecError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Mongo document validation failed: ${code}`); this.code = code; }
}
function check(value: unknown, code: string): asserts value { if (!value) throw new MongoCodecError(code); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const blocks = [...schema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)];
const enums = Object.fromEntries([...schema.matchAll(/^enum (\w+) \{\n([\s\S]*?)^\}/gm)].map(([, name, body]) => [name, body.split("\n").map(line => /^\s+(\w+)\b/.exec(line)?.[1]).filter((value): value is string => Boolean(value))]));
export const mongoModelContracts: Record<string, MongoModelContract> = {};
// Prisma 7 runtime DMMF omits native/nullable/list metadata. Cross-check its scalar names/types
// with this deliberately narrow checked-in-schema parser instead of guessing PostgreSQL types.
for (const model of Prisma.dmmf.datamodel.models) {
  const block = blocks.find((match) => match[1] === model.name);
  check(block, "SCHEMA_MODEL_DRIFT");
  const fields: Record<string, MongoFieldContract> = {};
  const definitions = [...block[2].matchAll(/^\s+(\w+)\s+(\w+)(\[\]|\?)?([^\n]*)$/gm)];
  for (const field of model.fields.filter(field => field.kind !== "object")) {
    const definition = definitions.find(match => match[1] === field.name);
    check(definition && definition[2] === field.type, "SCHEMA_FIELD_DRIFT");
    check(["String", "Int", "Boolean", "DateTime", "Decimal", "Bytes", "Json"].includes(field.type) || enums[field.type], "UNSUPPORTED_SCALAR");
    if (field.type === "Decimal") check(/@db.Decimal\(14,\s*2\)/.test(definition[4]), "UNSUPPORTED_DECIMAL");
    fields[field.name] = { type: field.type, nullable: definition[3] === "?", list: definition[3] === "[]", uuid: /@db.Uuid\b/.test(definition[4]), dateOnly: /@db.Date\b/.test(definition[4]), ...(enums[field.type] ? { values: enums[field.type] } : {}) };
  }
  const declaredScalars = definitions.filter(match => !blocks.some(block => block[1] === match[2]));
  check(declaredScalars.length === Object.keys(fields).length, "SCHEMA_FIELD_DRIFT");
  const composite = /@@id\(\[([^\]]+)\]/.exec(block[2]);
  const primaryKey = composite ? composite[1].split(",").map(field => field.trim()) : definitions.filter(match => /(?:^|\s)@id\b/.test(match[4])).map(match => match[1]);
  check(primaryKey.length && primaryKey.every(field => fields[field]?.type === "String" && fields[field].uuid && !fields[field].nullable), "UNSUPPORTED_PRIMARY_KEY");
  const references = definitions.filter(match => /@relation\(/.test(match[4])).map(match => {
    const relation = /@relation\([^\n]*fields:\s*\[([^\]]+)\][^\n]*references:\s*\[([^\]]+)\]/.exec(match[4]);
    check(relation, "UNSUPPORTED_RELATION");
    const local = relation[1].split(",").map(field => field.trim());
    const remote = relation[2].split(",").map(field => field.trim());
    check(local.length === remote.length && local.every(field => fields[field]), "SCHEMA_RELATION_DRIFT");
    return { fields: local, targetModel: match[2], targetFields: remote };
  });
  const rawUniqueKeys = [primaryKey, ...definitions.filter(match => /(?:^|\s)@unique\b/.test(match[4])).map(match => [match[1]]), ...[...block[2].matchAll(/@@unique\(\[([^\]]+)\]/g)].map(match => match[1].split(",").map(field => field.trim()))];
  const uniqueKeys = [...new Map(rawUniqueKeys.map(keys => {
    // Equality of encrypted fields is represented by the existing HMAC companion contract.
    const mapped = keys.map(key => privacyFields[model.name]?.fields[key]?.index ?? key);
    check(mapped.every(key => fields[key]), "SCHEMA_UNIQUE_DRIFT");
    return [JSON.stringify(mapped), { fields: mapped, nullsDistinct: true }];
  })).values()];
  mongoModelContracts[model.name] = { collection: model.dbName ?? model.name, primaryKey, fields, references, uniqueKeys };
}
check(Object.keys(mongoModelContracts).length === blocks.length, "SCHEMA_MODEL_DRIFT");
for (const model of Object.values(mongoModelContracts)) {
  for (const reference of model.references) check(reference.targetFields.every(field => mongoModelContracts[reference.targetModel]?.fields[field]), "SCHEMA_RELATION_DRIFT");
}
for (const [name, definition] of Object.entries(privacyFields)) {
  const model = mongoModelContracts[name];
  check(model && model.collection === definition.table, "PRIVACY_MODEL_DRIFT");
  for (const [field, policy] of Object.entries(definition.fields)) {
    check(model.fields[field]?.type === policy.type, "PRIVACY_FIELD_DRIFT");
    for (const companion of [policy.storage, policy.index]) if (companion) check(model.fields[companion]?.type === "String" && model.fields[companion].nullable, "PRIVACY_COMPANION_DRIFT");
  }
}
export const mongoModelNames = Object.freeze(Object.keys(mongoModelContracts));

function jsonValue(value: unknown, ancestors = new Set<unknown>()): CanonicalValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { check(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)), "INVALID_JSON_NUMBER"); return value; }
  check(!ancestors.has(value), "CYCLIC_JSON");
  check(Array.isArray(value) || object(value), "INVALID_JSON");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map(entry => jsonValue(entry, ancestors));
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry, ancestors)]));
  } finally { ancestors.delete(value); }
}
function scalar(field: MongoFieldContract, value: unknown): CanonicalValue {
  if (field.type === "Json" && !field.list) {
    if (value === Prisma.DbNull) { check(field.nullable, "REQUIRED_NULL"); return null; }
    if (value === Prisma.JsonNull) return { $jsonNull: true };
    check(value !== null, "AMBIGUOUS_JSON_NULL");
    return { $json: jsonValue(value) };
  }
  if (value === null) { check(field.nullable, "REQUIRED_NULL"); return null; }
  if (field.list) { check(Array.isArray(value), "INVALID_LIST"); return value.map(entry => scalar({ ...field, list: false, nullable: false }, entry)); }
  if (field.values) { check(typeof value === "string" && field.values.includes(value), "INVALID_ENUM"); return value; }
  switch (field.type) {
    case "String": check(typeof value === "string" && (!field.uuid || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)), "INVALID_STRING"); return value;
    case "Int": check(typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647, "INVALID_INT32"); return value;
    case "Boolean": check(typeof value === "boolean", "INVALID_BOOLEAN"); return value;
    case "Decimal": check(typeof value === "string" || Prisma.Decimal.isDecimal(value), "INVALID_DECIMAL"); return { $decimal: decimal14_2(typeof value === "string" ? value : (value as Prisma.Decimal).toFixed()) };
    case "Bytes": check(value instanceof Uint8Array, "INVALID_BYTES"); return { $bytes: Buffer.from(value).toString("base64") };
    case "DateTime": {
      check(value instanceof Date || typeof value === "string", "INVALID_DATE");
      const text = value instanceof Date ? value.toISOString() : value;
      const date = new Date(text);
      check(Number.isFinite(date.getTime()) && date.toISOString() === text && (!field.dateOnly || text.endsWith("T00:00:00.000Z")), "INVALID_DATE");
      return { $date: text };
    }
    default: throw new MongoCodecError("UNSUPPORTED_SCALAR");
  }
}
function fromScalar(field: MongoFieldContract, value: unknown): unknown {
  if (value === null) return field.type === "Json" ? Prisma.DbNull : null;
  if (field.list) { check(Array.isArray(value), "INVALID_LIST"); return value.map(entry => fromScalar({ ...field, list: false, nullable: false }, entry)); }
  if (["Decimal", "Bytes", "DateTime", "Json"].includes(field.type)) {
    check(object(value) && Object.keys(value).length === 1, "INVALID_TAG");
    if (field.type === "Json") {
      if (Object.hasOwn(value, "$jsonNull")) { check(value.$jsonNull === true, "INVALID_TAG"); return Prisma.JsonNull; }
      check(Object.hasOwn(value, "$json") && value.$json !== null, "INVALID_TAG"); return jsonValue(value.$json);
    }
    if (field.type === "Decimal") { check(typeof value.$decimal === "string", "INVALID_TAG"); return new Prisma.Decimal(decimal14_2(value.$decimal)); }
    if (field.type === "DateTime") { check(typeof value.$date === "string", "INVALID_TAG"); scalar(field, value.$date); return new Date(value.$date); }
    check(typeof value.$bytes === "string" && Buffer.from(value.$bytes, "base64").toString("base64") === value.$bytes, "INVALID_BYTES");
    return Buffer.from(value.$bytes, "base64");
  }
  scalar(field, value);
  return value;
}
function modelContract(name: string): MongoModelContract { check(Object.hasOwn(mongoModelContracts, name), "UNKNOWN_MODEL"); return mongoModelContracts[name]; }
function sourceKeys(name: string, row: unknown, mode: "plaintext" | "encrypted"): asserts row is Record<string, unknown> {
  check(object(row), "INVALID_ROW");
  const fields = modelContract(name).fields;
  const companions = new Set(Object.values(privacyFields[name]?.fields ?? {}).flatMap(policy => [policy.index, policy.storage].filter((field): field is string => Boolean(field))));
  check(Object.keys(row).every(key => Object.hasOwn(fields, key)), "UNKNOWN_FIELD");
  check(Object.keys(fields).every(key => Object.hasOwn(row, key) || (mode === "plaintext" && companions.has(key))), "MISSING_FIELD");
}

/** Explicit mode: envelope-looking plaintext is data, never silently treated as ciphertext.
 * Nullable source JSON must use Prisma.DbNull/JsonNull, not the ambiguous Prisma read-result null.
 * The caller must retain SQL IS NULL presence information when exporting PostgreSQL rows.
 */
export function encodeMongoDocument(name: string, row: Record<string, unknown>, options: { sourceMode: "plaintext" | "encrypted" }): CanonicalDocument {
  try {
    check(options?.sourceMode === "plaintext" || options?.sourceMode === "encrypted", "SOURCE_MODE_REQUIRED");
    const mode = options.sourceMode;
    sourceKeys(name, row, mode);
    const contract = modelContract(name);
    const stored = { ...row };
    for (const [field, policy] of Object.entries(privacyFields[name]?.fields ?? {})) {
      const storage = policy.storage ?? field;
      let plain: unknown;
      if (mode === "encrypted") {
        const encrypted = row[storage];
        if (policy.storage) check(row[field] === null, "CONFLICTING_DATE_STORAGE");
        if (encrypted === null || encrypted === Prisma.DbNull) {
          check(policy.nullable, "REQUIRED_NULL");
          plain = policy.type === "Json" ? Prisma.DbNull : null;
        } else {
          check(storedEncrypted(policy, encrypted), "PLAINTEXT_IN_ENCRYPTED_SOURCE");
          if (policy.type === "Json") check(object(encrypted) && Object.keys(encrypted).length === 1, "INVALID_ENCRYPTED_JSON");
          plain = decryptField(name, field, encrypted);
          if (policy.type === "Json" && plain === null) plain = Prisma.JsonNull;
          scalar(contract.fields[field], plain);
        }
      } else {
        plain = row[field];
        scalar(contract.fields[field], plain);
        if (policy.storage) check(row[storage] == null, "CONFLICTING_DATE_STORAGE");
        stored[storage] = encryptField(name, field, plain);
        if (policy.storage) stored[field] = null;
      }
      if (policy.index) {
        const expected = indexField(name, field, plain);
        if (mode === "encrypted" || row[policy.index] != null) check(row[policy.index] === expected, "INDEX_MISMATCH");
        stored[policy.index] = expected;
      }
    }
    const document = Object.fromEntries(Object.entries(contract.fields).map(([field, definition]) => [field === "id" ? "_id" : field, scalar(definition, stored[field])]));
    document._id = mongoSourceId(name, stored);
    return document as CanonicalDocument;
  } catch (error) { if (error instanceof MongoCodecError) throw error; throw new MongoCodecError("INVALID_VALUE_OR_AUTHENTICATION"); }
}

/** Authenticates ciphertext and companions before exposing a logical scalar row. */
export function decodeMongoDocument(name: string, document: CanonicalDocument): Record<string, unknown> {
  try {
    const contract = modelContract(name);
    check(object(document) && Object.keys(document).length === Object.keys(contract.fields).length + (contract.fields.id ? 0 : 1) && Object.keys(document).every(key => key === "_id" || (key !== "id" && Object.hasOwn(contract.fields, key))), "TARGET_FIELD_COVERAGE");
    const stored = Object.fromEntries(Object.entries(contract.fields).map(([field, definition]) => [field, fromScalar(definition, document[field === "id" ? "_id" : field])]));
    check(document._id === mongoSourceId(name, stored), "TARGET_ID_MISMATCH");
    encodeMongoDocument(name, stored, { sourceMode: "encrypted" });
    const plain = { ...stored };
    for (const [field, policy] of Object.entries(privacyFields[name]?.fields ?? {})) {
      const value = stored[policy.storage ?? field];
      plain[field] = value === Prisma.DbNull ? Prisma.DbNull : decryptField(name, field, value);
      if (policy.type === "Json" && plain[field] === null && value !== null) plain[field] = Prisma.JsonNull;
      if (policy.storage) plain[policy.storage] = null;
    }
    return plain;
  } catch (error) { if (error instanceof MongoCodecError) throw error; throw new MongoCodecError("INVALID_VALUE_OR_AUTHENTICATION"); }
}


export function mongoSourceId(name: string, row: Record<string, unknown>): string {
  const contract = modelContract(name);
  const parts = contract.primaryKey.map(key => scalar(contract.fields[key], row[key]));
  return parts.length === 1 ? String(parts[0]) : `compound:${JSON.stringify(parts)}`;
}
function canonical(value: CanonicalValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Exact ciphertext digest, only after schema, authentication and companion validation. */
export function hashMongoDocument(name: string, document: CanonicalDocument): string {
  decodeMongoDocument(name, document);
  return createHash("sha256").update(canonical(document)).digest("hex");
}
