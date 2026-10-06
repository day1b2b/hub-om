import { Binary, Decimal128, MongoClient, MongoServerError, type Db, type Document } from "mongodb";
import { mongoModelContracts, hashMongoDocument, type CanonicalDocument, type CanonicalValue, type MongoFieldContract } from "../migration/mongoDocumentCodec";
import type { ShadowDocument, ShadowTarget } from "../migration/mongoShadowTransfer";
import { MongoPreparationError, configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "./connection";

function toBson(field: MongoFieldContract, value: CanonicalValue): unknown {
  if (value === null) return null;
  if (field.list) return (value as CanonicalValue[]).map(v => toBson({ ...field, list: false }, v));
  const tag = value as Record<string, string>;
  if (field.type === "DateTime") return new Date(tag.$date);
  if (field.type === "Decimal") return Decimal128.fromString(tag.$decimal);
  if (field.type === "Bytes") return new Binary(Buffer.from(tag.$bytes, "base64"));
  // JSON is already wrapped by the codec. Never apply generic EJSON parsing to user JSON.
  return value;
}
function fromBson(field: MongoFieldContract, value: unknown): CanonicalValue {
  if (value === null) return null;
  if (field.list) {
    if (!Array.isArray(value)) throw new MongoPreparationError("INVALID_BSON_LIST");
    return value.map(v => fromBson({ ...field, list: false }, v));
  }
  if (field.type === "DateTime") {
    if (!(value instanceof Date)) throw new MongoPreparationError("INVALID_BSON_DATE");
    return { $date: value.toISOString() };
  }
  if (field.type === "Decimal") {
    if (!(value instanceof Decimal128)) throw new MongoPreparationError("INVALID_BSON_DECIMAL");
    return { $decimal: value.toString() };
  }
  if (field.type === "Bytes") {
    if (!(value instanceof Binary) || value.sub_type !== 0) throw new MongoPreparationError("INVALID_BSON_BYTES");
    return { $bytes: Buffer.from(value.value()).toString("base64") };
  }
  return value as CanonicalValue;
}
export function canonicalToBson(model: string, document: CanonicalDocument): Document {
  hashMongoDocument(model, document);
  return Object.fromEntries(Object.entries(document).map(([key, value]) => [key, key === "_id" ? value : toBson(mongoModelContracts[model].fields[key], value)]));
}
export function bsonToCanonical(model: string, document: Document): CanonicalDocument {
  const fields = mongoModelContracts[model]?.fields;
  if (!fields || Object.keys(document).some(key => key !== "_id" && !Object.hasOwn(fields, key))) throw new MongoPreparationError("INVALID_BSON_FIELDS");
  const result = Object.fromEntries(Object.entries(document).map(([key, value]) => [key, key === "_id" ? value : fromBson(fields[key], value)])) as CanonicalDocument;
  hashMongoDocument(model, result);
  return result;
}
function collectionName(namespace: string, model: string) {
  if (!/^shadow_[A-Za-z0-9_-]{1,80}$/.test(namespace) || (model !== "__run" && !Object.hasOwn(mongoModelContracts, model))) throw new MongoPreparationError("INVALID_SHADOW_NAMESPACE");
  return `${namespace}_${model}`;
}

/** Only insert-only isolated namespaces. There is no update, delete, drop, or production fallback API. */
export class NativeMongoShadowTarget implements ShadowTarget {
  readonly databaseName: string;
  private readonly db: Db;
  constructor(db: Db) {
    shadowDatabaseName({ MONGODB_SHADOW_DATABASE: db.databaseName });
    this.db = db; this.databaseName = db.databaseName;
  }
  private collection(namespace: string, model: string) {
    return this.db.collection<Document & { _id: string }>(collectionName(namespace, model), { readConcern: { level: "majority" }, writeConcern: { w: "majority", j: true }, promoteBuffers: false });
  }
  private encode(model: string, document: ShadowDocument): Document & { _id: string } {
    if (model === "__run") {
      if (document._id !== "manifest" || Object.keys(document).sort().join() !== "_id,identity" || typeof document.identity !== "string" || !/^[0-9a-f]{64}$/.test(document.identity)) throw new MongoPreparationError("INVALID_RUN_RECORD");
      return { _id: "manifest", identity: document.identity };
    }
    return canonicalToBson(model, document as CanonicalDocument) as Document & { _id: string };
  }
  private decode(model: string, document: Document): ShadowDocument {
    return model === "__run" ? this.encode(model, document as ShadowDocument) : bsonToCanonical(model, document);
  }
  async insertOnly(namespace: string, model: string, document: ShadowDocument): Promise<boolean> {
    const encoded = this.encode(model, document);
    try { await this.collection(namespace, model).insertOne(encoded); return true; }
    catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return false;
      throw new MongoPreparationError("SHADOW_INSERT_FAILED");
    }
  }
  async get(namespace: string, model: string, id: string): Promise<ShadowDocument | null> {
    try { const row = await this.collection(namespace, model).findOne({ _id: id }, { maxTimeMS: 15000 }); return row ? this.decode(model, row) : null; }
    catch { throw new MongoPreparationError("SHADOW_READ_FAILED"); }
  }
  async page(namespace: string, model: string, afterId: string | null, limit: number): Promise<ShadowDocument[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new MongoPreparationError("INVALID_PAGE_SIZE");
    try {
      const rows = await this.collection(namespace, model).find(afterId === null ? {} : { _id: { $gt: afterId } }, { maxTimeMS: 15000, collation: { locale: "simple" } }).sort({ _id: 1 }).limit(limit).toArray();
      return rows.map(row => this.decode(model, row));
    } catch { throw new MongoPreparationError("SHADOW_PAGE_FAILED"); }
  }
  async count(namespace: string, model: string) {
    try { return await this.collection(namespace, model).countDocuments({}, { maxTimeMS: 15000 }); }
    catch { throw new MongoPreparationError("SHADOW_COUNT_FAILED"); }
  }
}

export async function openMongoShadowTarget(env: Record<string, string | undefined> = process.env) {
  if (env.MONGODB_ALLOW_SHADOW_WRITES !== "true") throw new MongoPreparationError("SHADOW_WRITES_NOT_ENABLED");
  const databaseName = shadowDatabaseName(env);
  let client: MongoClient | undefined;
  try {
    client = new MongoClient(configuredMongoUri(env), mongoConnectionOptions());
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    const sharded = hello.msg === "isdbgrid";
    if (!(typeof hello.setName === "string" || sharded) || typeof hello.logicalSessionTimeoutMinutes !== "number" || typeof hello.maxWireVersion !== "number" || hello.maxWireVersion < (sharded ? 8 : 7)) throw new MongoPreparationError("TRANSACTIONS_REQUIRED");
    return { target: new NativeMongoShadowTarget(client.db(databaseName)), client };
  } catch (error) {
    if (client) await client.close().catch(() => {});
    throw error instanceof MongoPreparationError ? error : new MongoPreparationError("SHADOW_CONNECTION_FAILED");
  }
}
