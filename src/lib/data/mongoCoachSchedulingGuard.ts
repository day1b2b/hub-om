import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { assertMongo, stableMongoValue, type MongoOperationStore } from "./mongoOperationStore";

const uuid = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";
export const coachSchedulingGuardValidator = { $jsonSchema: { bsonType: "object", required: ["_id", "nonce"], additionalProperties: false,
  properties: { _id: { bsonType: "string", pattern: uuid }, nonce: { bsonType: "string", pattern: uuid } } } };
/** Internal coordination, not a business schema field. Never TTL/delete guards during normal work. */
export function coachSchedulingGuardCollection(store: MongoOperationStore) {
  return store.db.collection<{ _id: string; nonce: string }>(`${store.namespace}_CoachSchedulingGuard`);
}
export async function prepareMongoCoachSchedulingGuard(store: MongoOperationStore, allowShadowWrites: true): Promise<void> {
  assertMongo(allowShadowWrites === true, "SHADOW_WRITE_GATE");
  const collection = coachSchedulingGuardCollection(store);
  const existing = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  if (!existing) await store.db.createCollection(collection.collectionName, { validator: coachSchedulingGuardValidator, validationLevel: "strict", validationAction: "error", collation: { locale: "simple" } });
  // Existing coordination collections must already satisfy the contract. Do not silently
  // repair validators, remove documents, or replace a live serialization point.
  await assertMongoCoachSchedulingGuardReady(store);
}
export async function assertMongoCoachSchedulingGuardReady(store: MongoOperationStore): Promise<void> {
  const collection = coachSchedulingGuardCollection(store);
  const info = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  assertMongo(info && info.options?.validationLevel === "strict" && info.options?.validationAction === "error"
    && stableMongoValue(info.options.validator) === stableMongoValue(coachSchedulingGuardValidator)
    && (!info.options.collation || info.options.collation.locale === "simple") && !info.options.capped, "COACH_SCHEDULING_GUARD_NOT_READY");
  const indexes = await collection.listIndexes().toArray();
  assertMongo(indexes.some(index => index.name === "_id_" && JSON.stringify(index.key) === JSON.stringify({ _id: 1 }))
    && indexes.every(index => index.expireAfterSeconds === undefined), "COACH_SCHEDULING_GUARD_NOT_READY");
}
/** Every scheduling writer must call this in its business transaction before predicate reads.
 * A fresh nonce forces a real write even when the business predicate is empty. Mongo write
 * conflicts retry the whole transaction, including all reads. First-upsert duplicates are
 * also retried by the repository. The guard and business writes commit or abort together.
 */
export async function lockMongoCoachScheduling(store: MongoOperationStore, coachId: string, session: ClientSession): Promise<void> {
  const result = await coachSchedulingGuardCollection(store).updateOne({ _id: coachId.toLowerCase() }, { $set: { nonce: randomUUID() } }, { session, upsert: true });
  assertMongo(result.matchedCount === 1 || result.upsertedCount === 1, "COACH_SCHEDULING_GUARD_FAILED");
}
