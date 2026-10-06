import { BSON, type ClientSession, type CollectionInfo, type Db, type Document, type IndexDescription, type IndexDescriptionInfo, type MongoClient } from "mongodb";
import { createHash } from "node:crypto";

const NAMESPACE = /^shadow_[A-Za-z0-9_-]{1,80}$/;
const MAX_COLLECTIONS = 128;
const MAX_DOCUMENTS = 1_000_000;
const MAX_BYTES = 256 * 1024 * 1024;

export class MongoNamespaceRecoveryError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Mongo namespace recovery failed: ${code}`); this.code = code; }
}

function check(value: unknown, code: string): asserts value {
  if (!value) throw new MongoNamespaceRecoveryError(code);
}

type CapturedCollection = {
  suffix: string;
  options: NonNullable<CollectionInfo["options"]>;
  indexes: IndexDescriptionInfo[];
  documents: Document[];
};

function hashDocument(hash: ReturnType<typeof createHash>, suffix: string, document: Document) {
  const bytes = BSON.serialize(document, { checkKeys: false });
  hash.update(JSON.stringify([suffix, bytes.length]) + "\n");
  hash.update(bytes);
  return bytes.length;
}

async function capture(db: Db, namespace: string, session: ClientSession): Promise<{ collections: CapturedCollection[]; digest: string; documents: number; bytes: number }> {
  const prefix = `${namespace}_`;
  // MongoDB forbids listCollections/listIndexes in multi-document transactions.
  // Source writes are explicitly frozen; metadata is read outside the transaction,
  // while documents use one snapshot and are rechecked after materialization.
  const infos = (await db.listCollections({}, { nameOnly: false }).toArray())
    .filter(info => info.name.startsWith(prefix))
    .sort((left, right) => left.name.localeCompare(right.name));
  check(infos.length > 0 && infos.length <= MAX_COLLECTIONS, "SOURCE_COLLECTION_COVERAGE");
  const hash = createHash("sha256");
  const collections: CapturedCollection[] = [];
  let documentCount = 0;
  let byteCount = 0;
  for (const info of infos) {
    const suffix = info.name.slice(prefix.length);
    check(suffix.length > 0 && !suffix.includes("\0"), "SOURCE_COLLECTION_NAME");
    const collection = db.collection(info.name, { promoteBuffers: false });
    const indexes = await collection.listIndexes().toArray();
    const documents = await collection.find({}, { session, collation: { locale: "simple" } }).sort({ _id: 1 }).toArray();
    for (const document of documents) {
      documentCount++;
      byteCount += hashDocument(hash, suffix, document);
      check(documentCount <= MAX_DOCUMENTS && byteCount <= MAX_BYTES, "SOURCE_SIZE_LIMIT");
    }
    collections.push({ suffix, options: structuredClone(info.options ?? {}), indexes, documents });
  }
  return { collections, digest: hash.digest("hex"), documents: documentCount, bytes: byteCount };
}

function indexDescription(index: IndexDescriptionInfo): IndexDescription {
  return {
    key: index.key,
    name: index.name,
    ...(index.unique === undefined ? {} : { unique: index.unique }),
    ...(index.sparse === undefined ? {} : { sparse: index.sparse }),
    ...(index.expireAfterSeconds === undefined ? {} : { expireAfterSeconds: index.expireAfterSeconds }),
    ...(index.partialFilterExpression === undefined ? {} : { partialFilterExpression: index.partialFilterExpression }),
    ...(index.collation === undefined ? {} : { collation: index.collation }),
    ...(index.hidden === undefined ? {} : { hidden: index.hidden }),
  };
}

async function assertTargetAbsent(db: Db, namespace: string) {
  const found = await db.listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).next();
  check(!found, "TARGET_NOT_EMPTY");
}

async function materialize(db: Db, namespace: string, captured: CapturedCollection[]) {
  for (const item of captured) {
    const name = `${namespace}_${item.suffix}`;
    await db.createCollection(name, item.options);
    const collection = db.collection(name, { promoteBuffers: false });
    const indexes = item.indexes.filter(index => index.name !== "_id_").map(indexDescription);
    if (indexes.length) await collection.createIndexes(indexes);
    for (let offset = 0; offset < item.documents.length; offset += 500) {
      await collection.insertMany(item.documents.slice(offset, offset + 500), { ordered: true });
    }
  }
}

async function digestCurrent(client: MongoClient, db: Db, namespace: string) {
  const session = client.startSession();
  try {
    session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true } });
    const result = await capture(db, namespace, session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction().catch(() => undefined);
    throw error;
  } finally { await session.endSession(); }
}

/**
 * Copies one frozen runtime namespace into a new namespace without touching the source.
 * A second source digest rejects a writer that entered during recovery preparation.
 */
export async function recoverMongoNamespace(input: {
  client: MongoClient;
  databaseName: string;
  sourceNamespace: string;
  targetNamespace: string;
  sourceWritesFrozen: true;
}) {
  check(input.sourceWritesFrozen === true, "SOURCE_FREEZE_REQUIRED");
  check(NAMESPACE.test(input.sourceNamespace) && NAMESPACE.test(input.targetNamespace) && input.sourceNamespace !== input.targetNamespace, "NAMESPACE");
  const db = input.client.db(input.databaseName);
  await assertTargetAbsent(db, input.targetNamespace);
  const before = await digestCurrent(input.client, db, input.sourceNamespace);
  try {
    await materialize(db, input.targetNamespace, before.collections);
    const [sourceAfter, target] = await Promise.all([
      digestCurrent(input.client, db, input.sourceNamespace),
      digestCurrent(input.client, db, input.targetNamespace),
    ]);
    check(sourceAfter.digest === before.digest && sourceAfter.documents === before.documents && sourceAfter.bytes === before.bytes, "SOURCE_CHANGED_DURING_RECOVERY");
    check(target.digest === before.digest && target.documents === before.documents && target.bytes === before.bytes, "TARGET_CONTENT_MISMATCH");
    check(target.collections.length === before.collections.length, "TARGET_COLLECTION_MISMATCH");
    return Object.freeze({ status: "recovery-verified" as const, sourceNamespace: input.sourceNamespace, targetNamespace: input.targetNamespace,
      collectionCount: before.collections.length, documentCount: before.documents, byteCount: before.bytes, digest: before.digest,
      sourceUnchanged: true as const, targetVerified: true as const, cutoverAuthorized: false as const });
  } catch (error) {
    throw error instanceof MongoNamespaceRecoveryError ? error : new MongoNamespaceRecoveryError("RECOVERY_COPY_FAILED");
  }
}
