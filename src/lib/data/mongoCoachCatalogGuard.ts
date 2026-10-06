import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { assertMongo, stableMongoValue, type MongoOperationStore } from "./mongoOperationStore";

const uuid = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";
export const coachCatalogGuardValidator = { $jsonSchema: { bsonType: "object", required: ["_id", "nonce"], additionalProperties: false,
  properties: { _id: { enum: ["catalog"] }, nonce: { bsonType: "string", pattern: uuid } } } };
/** Internal coordination, not a business schema field. Never TTL/delete guards during normal work. */
export function coachCatalogGuardCollection(store: MongoOperationStore) {
  return store.db.collection<{ _id: string; nonce: string }>(`${store.namespace}_CoachCatalogGuard`);
}
export async function prepareMongoCoachCatalogGuard(store: MongoOperationStore, allowShadowWrites: true): Promise<void> {
  assertMongo(allowShadowWrites === true, "SHADOW_WRITE_GATE");
  const collection = coachCatalogGuardCollection(store);
  const existing = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  if (!existing) await store.db.createCollection(collection.collectionName, { validator: coachCatalogGuardValidator, validationLevel: "strict", validationAction: "error", collation: { locale: "simple" } });
  // Existing coordination collections must already satisfy the contract. Do not silently
  // repair validators, remove documents, or replace a live serialization point.
  await assertMongoCoachCatalogGuardReady(store);
}
export async function assertMongoCoachCatalogGuardReady(store: MongoOperationStore): Promise<void> {
  const collection = coachCatalogGuardCollection(store);
  const info = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  assertMongo(info && info.options?.validationLevel === "strict" && info.options?.validationAction === "error"
    && stableMongoValue(info.options.validator) === stableMongoValue(coachCatalogGuardValidator)
    && (!info.options.collation || info.options.collation.locale === "simple") && !info.options.capped, "COACH_CATALOG_GUARD_NOT_READY");
  const indexes = await collection.listIndexes().toArray();
  assertMongo(indexes.some(index => index.name === "_id_" && JSON.stringify(index.key) === JSON.stringify({ _id: 1 }))
    && indexes.every(index => index.expireAfterSeconds === undefined), "COACH_CATALOG_GUARD_NOT_READY");
}
/** Identity and engagement-set writers call this before predicate reads and coach locks.
 * A fresh nonce forces a real write even when the business predicate is empty. Mongo write
 * conflicts retry the whole transaction, including all reads. First-upsert duplicates are
 * also retried by the repository. The guard and business writes commit or abort together.
 */
export async function lockMongoCoachCatalog(store: MongoOperationStore, session: ClientSession): Promise<void> {
  const result = await coachCatalogGuardCollection(store).updateOne({ _id: "catalog" }, { $set: { nonce: randomUUID() } }, { session, upsert: true });
  assertMongo(result.matchedCount === 1 || result.upsertedCount === 1, "COACH_CATALOG_GUARD_FAILED");
}
