import { BSON, type ClientSession, type Db, type Document, type Filter, type IndexDescription, type MongoClient } from "mongodb";
import { mongoRuntimeContracts, mongoRuntimeBlindIndex, decodeMongoRuntimeDocument, MongoDbNull, type MongoRuntimeDocument } from "./mongoRuntimeCodec";
import policies from "../privacy/fields.json" with { type: "json" };

export type MongoRow = Record<string, unknown>;
export const OPERATION_MODELS = ["Company", "Course", "CourseIdLabel", "OperationSession", "OperationSourceRecord", "TeamUser", "ActivityChange"] as const;
const INTERNAL_MODELS = ["__creation", "__counter"];
export const MONGO_SCAN_ROWS = 20_000;
export const MONGO_SCAN_BYTES = 32 * 1024 * 1024;
export class MongoOperationError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Mongo operation failed: ${code}`); this.code = code; }
}
export function assertMongo(condition: unknown, code: string): asserts condition { if (!condition) throw new MongoOperationError(code); }
export function stableMongoValue(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableMongoValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stableMongoValue(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export interface MongoOperationOptions {
  client: MongoClient;
  databaseName: string;
  namespace: string;
}
/** No environment fallback and no production database names during parallel validation. */
export class MongoOperationStore {
  readonly db: Db;
  readonly namespace: string;
  readonly client: MongoClient;
  constructor(options: MongoOperationOptions) {
    assertMongo(/^hub_om_shadow_[A-Za-z0-9_]{1,64}$/.test(options.databaseName), "SHADOW_DATABASE_REQUIRED");
    assertMongo(/^shadow_[A-Za-z0-9_-]{1,80}$/.test(options.namespace), "INVALID_NAMESPACE");
    this.client = options.client;
    this.db = options.client.db(options.databaseName);
    this.namespace = options.namespace;
  }
  collection(model: string) {
    assertMongo((OPERATION_MODELS as readonly string[]).includes(model) || INTERNAL_MODELS.includes(model), "UNKNOWN_OPERATION_MODEL");
    return this.db.collection<MongoRuntimeDocument>(`${this.namespace}_${model}`, { promoteBuffers: false });
  }
  async one(model: string, filter: Filter<MongoRuntimeDocument>, session?: ClientSession): Promise<MongoRow | null> {
    const row = await this.collection(model).findOne(filter, { session, maxTimeMS: 15_000, collation: { locale: "simple" } });
    return row ? decodeMongoRuntimeDocument(model, row) : null;
  }
  async scan(model: string, filter: Filter<MongoRuntimeDocument> = {}, session?: ClientSession): Promise<MongoRow[]> {
    const rows: MongoRow[] = []; let bytes = 0;
    const cursor = this.collection(model).find(filter, { session, maxTimeMS: 15_000, collation: { locale: "simple" } }).limit(MONGO_SCAN_ROWS + 1);
    try {
      for await (const row of cursor) {
        bytes += BSON.calculateObjectSize(row);
        assertMongo(rows.length < MONGO_SCAN_ROWS && bytes <= MONGO_SCAN_BYTES, "SCAN_LIMIT_EXCEEDED");
        const plain = decodeMongoRuntimeDocument(model, row);
        rows.push(plain);
      }
      return rows;
    } finally { await cursor.close(); }
  }
  /** Equality uses the existing field-scoped HMAC; authenticated full rows still enforce integrity. */
  async findPrivateEqual(model: string, field: string, value: string | null, session?: ClientSession): Promise<MongoRow[]> {
    const policy = (policies as Record<string, { fields: Record<string, { index?: string }> }>)[model]?.fields[field];
    assertMongo(policy?.index && (typeof value === "string" || value === null), "PRIVATE_EQUALITY_NOT_SUPPORTED");
    const rows = await this.scan(model, { [policy.index]: mongoRuntimeBlindIndex(model, field, value) }, session);
    assertMongo(rows.every(row => row[field] === value), "PRIVATE_EQUALITY_MISMATCH");
    return rows;
  }
  /** Keep complete authenticated documents, but select the latest relation on the server. */
  async latestBy(model: "OperationSourceRecord" | "OperationSession", foreignKey: string, ids: string[], dateField: string, session?: ClientSession): Promise<MongoRow[]> {
    const cursor = this.collection(model).aggregate<MongoRuntimeDocument>([
      { $match: { [foreignKey]: { $in: ids }, ...(model === "OperationSession" ? { deletedAt: null } : {}) } },
      { $sort: { [foreignKey]: 1, [dateField]: -1, _id: 1 } },
      { $group: { _id: `$${foreignKey}`, document: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$document" } },
      { $limit: MONGO_SCAN_ROWS + 1 }
    ], { session, maxTimeMS: 15_000, collation: { locale: "simple" } });
    const result: MongoRow[] = []; let bytes = 0;
    try {
      for await (const row of cursor) {
        bytes += BSON.calculateObjectSize(row);
        assertMongo(result.length < MONGO_SCAN_ROWS && bytes <= MONGO_SCAN_BYTES, "SCAN_LIMIT_EXCEEDED");
        result.push(decodeMongoRuntimeDocument(model, row));
      }
      return result;
    } finally { await cursor.close(); }
  }
}

/** Defaults are deliberately limited to nullable/list/timestamp/id fields; required domain values must be supplied. */
export function completeMongoRow(model: string, fields: MongoRow): MongoRow {
  const result: MongoRow = {};
  const hidden = new Set(Object.values((policies as Record<string, { fields: Record<string, { index?: string; storage?: string }> }>)[model]?.fields ?? {}).flatMap(policy => [policy.index, policy.storage].filter(Boolean)));
  for (const [name, field] of Object.entries(mongoRuntimeContracts[model].fields)) {
    if (hidden.has(name)) continue;
    if (Object.hasOwn(fields, name)) result[name] = fields[name];
    else if (field.list) result[name] = [];
    else if (field.nullable) result[name] = field.type === "Json" ? MongoDbNull : null;
  }
  return Object.fromEntries(Object.entries({ ...result, ...fields }).filter(([name]) => !hidden.has(name)));
}

type Field = (typeof mongoRuntimeContracts)[string]["fields"][string];
function fieldSchema(field: Field): Document {
  if (field.list) return { bsonType: "array", items: fieldSchema({ ...field, list: false, nullable: false }) };
  if (field.type === "Json") return { oneOf: [
    ...(field.nullable ? [{ bsonType: "null" }] : []),
    { bsonType: "object", required: ["$json"], additionalProperties: false, properties: { $json: {} } },
    { bsonType: "object", required: ["$jsonNull"], additionalProperties: false, properties: { $jsonNull: { enum: [true] } } }
  ] };
  const type = field.values ? "string" : ({ String: "string", Int: "int", Boolean: "bool", DateTime: "date", Decimal: "decimal", Bytes: "binData", Json: "object" } as Record<string, string>)[field.type];
  const schema: Document = { bsonType: field.nullable ? [type, "null"] : type };
  if (field.values) schema.enum = field.nullable ? [...field.values, null] : field.values;
  if (field.uuid) schema.pattern = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";
  return schema;
}
export function operationMongoValidator(model: string): Document {
  if (model === "__creation") return { $jsonSchema: { bsonType: "object", required: ["_id", "operationId"], additionalProperties: false, properties: { _id: { bsonType: "string", pattern: "^[a-f0-9]{64}$" }, operationId: { bsonType: "string" } } } };
  if (model === "__counter") return { $jsonSchema: { bsonType: "object", required: ["_id", "value"], additionalProperties: false, properties: { _id: { enum: ["Course.processSeq"] }, value: { bsonType: "int", minimum: 0, maximum: 2147483647 } } } };
  const contract = mongoRuntimeContracts[model];
  const properties: Document = {};
  for (const [name, field] of Object.entries(contract.fields)) properties[name === "id" ? "_id" : name] = fieldSchema(field);
  const privacy = (policies as Record<string, { fields: Record<string, { type: string; index?: string; storage?: string }> }>)[model]?.fields ?? {};
  const envelope = "^pii:v1:[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$";
  for (const [name, policy] of Object.entries(privacy)) {
    if (policy.type === "String" || policy.storage) properties[policy.storage ?? name].pattern = envelope;
    if (policy.storage) properties[name] = { bsonType: "null" };
    if (policy.type === "Json") properties[name] = { oneOf: [
      ...(contract.fields[name].nullable ? [{ bsonType: "null" }] : []),
      { bsonType: "object", required: ["$json"], additionalProperties: false, properties: {
        $json: { bsonType: "object", required: ["__pii"], additionalProperties: false, properties: { __pii: { bsonType: "string", pattern: envelope } } }
      } }
    ] };
    if (policy.index) properties[policy.index].pattern = "^[a-f0-9]{64}$";
  }
  if (model === "Course") properties.processSeq.minimum = 1;
  const nullPairs = Object.entries(privacy).flatMap(([name, policy]) => policy.index ? [{ $expr: { $eq: [{ $eq: [`$${name}`, null] }, { $eq: [`$${policy.index}`, null] }] } }] : []);
  const shape = { $jsonSchema: { bsonType: "object", required: Object.keys(properties), additionalProperties: false, properties } };
  return nullPairs.length ? { $and: [shape, ...nullPairs] } : shape;
}
export function operationMongoIndexes(model: string): IndexDescription[] {
  if (INTERNAL_MODELS.includes(model)) return [];
  const contract = mongoRuntimeContracts[model];
  const seen = new Set<string>();
  const unique = contract.uniqueKeys.flatMap(({ fields, nullsDistinct }): IndexDescription[] => {
    const names = fields.map(field => field === "id" ? "_id" : field);
    if (names.length === 1 && names[0] === "_id") return [];
    const key = Object.fromEntries(names.map(name => [name, 1]));
    if (seen.has(JSON.stringify(key))) return [];
    seen.add(JSON.stringify(key));
    const nullable = fields.filter(field => nullsDistinct && contract.fields[field].nullable);
    return [{ name: `runtime_unique_${names.join("_")}`, key, unique: true,
      ...(nullable.length ? { partialFilterExpression: Object.fromEntries(nullable.map(name => [name, { $type: contract.fields[name].type === "Int" ? "int" : "string" }])) } : {}) }];
  });
  const extra: Record<string, Record<string, 1 | -1>[]> = {
    OperationSession: [{ deletedAt: 1, startDate: 1, operationId: 1 }, { courseRecordId: 1, startDate: -1, _id: 1 }],
    OperationSourceRecord: [{ operationSessionId: 1, createdAt: -1, _id: 1 }],
    ActivityChange: [{ targetType: 1, targetId: 1, occurredAt: 1 }, { requestId: 1 }]
  };
  const privateIndexes = Object.values((policies as Record<string, { fields: Record<string, { index?: string }> }>)[model]?.fields ?? {}).flatMap(policy => {
    if (!policy.index) return [];
    const key = { [policy.index]: 1 };
    if (seen.has(JSON.stringify(key))) return [];
    seen.add(JSON.stringify(key));
    return [{ name: `runtime_pii_${policy.index}`, key }];
  });
  return [...unique, ...privateIndexes, ...(extra[model] ?? []).map((key, i) => ({ name: `runtime_lookup_${i}`, key }))];
}

/** Explicit setup only: never invoked by the production factory or normal repository reads/writes. */
export async function prepareMongoOperationStore(options: MongoOperationOptions & { allowShadowWrites: true; processSequenceHighWater: number }): Promise<void> {
  assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
  assertMongo(Number.isInteger(options.processSequenceHighWater) && options.processSequenceHighWater >= 0 && options.processSequenceHighWater < 2147483647, "INVALID_SEQUENCE_HIGH_WATER");
  const store = new MongoOperationStore(options);
  for (const model of [...OPERATION_MODELS, ...INTERNAL_MODELS]) {
    const collection = store.collection(model);
    const validator = operationMongoValidator(model);
    const exists = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
    if (!exists) await store.db.createCollection(collection.collectionName, { validator, validationLevel: "strict", validationAction: "error", collation: { locale: "simple" } });
    else await store.db.command({ collMod: collection.collectionName, validator, validationLevel: "strict", validationAction: "error" });
    const indexes = operationMongoIndexes(model);
    if (indexes.length) await collection.createIndexes(indexes, { collation: { locale: "simple" } });
  }
  const maximum = await store.collection("Course").find({}, { projection: { processSeq: 1 } }).sort({ processSeq: -1 }).limit(1).next();
  const max = maximum?.processSeq ?? 0;
  assertMongo(Number.isInteger(max) && max >= 0 && max < 2147483647, "INVALID_STORED_SEQUENCE");
  await store.collection("__counter").updateOne({ _id: "Course.processSeq" }, { $max: { value: Math.max(max, options.processSequenceHighWater) } }, { upsert: true });
  await assertMongoOperationStoreReady(store);
}
export async function assertMongoOperationStoreReady(store: MongoOperationStore) {
  const hello = await store.db.command({ hello: 1 });
  assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
  for (const model of [...OPERATION_MODELS, ...INTERNAL_MODELS]) {
    const collection = store.collection(model);
    const info = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
    assertMongo(info && info.options?.validationLevel === "strict" && info.options?.validationAction === "error" && stableMongoValue(info.options.validator) === stableMongoValue(operationMongoValidator(model)), "VALIDATOR_NOT_READY");
    assertMongo(!info.options.collation || info.options.collation.locale === "simple", "COLLATION_NOT_SUPPORTED");
    const indexes = await collection.listIndexes().toArray();
    for (const expected of operationMongoIndexes(model)) {
      const actual = indexes.find(index => index.name === expected.name);
      assertMongo(actual && JSON.stringify(actual.key) === JSON.stringify(expected.key) && !!actual.unique === !!expected.unique && stableMongoValue(actual.partialFilterExpression) === stableMongoValue(expected.partialFilterExpression) && !actual.sparse && !actual.hidden && (!actual.collation || actual.collation.locale === "simple"), "INDEX_NOT_READY");
    }
  }
  const counter = await store.collection("__counter").findOne({ _id: "Course.processSeq" });
  const maximum = await store.collection("Course").find({}, { projection: { processSeq: 1 } }).sort({ processSeq: -1 }).limit(1).next();
  assertMongo(counter && Number.isInteger(counter.value) && counter.value >= (maximum?.processSeq ?? 0), "COUNTER_NOT_READY");
}
