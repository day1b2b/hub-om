import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import type { MongoOperationStore } from "./mongoOperationStore";
import { assertMongo, stableMongoValue } from "./mongoOperationPrimitives";

const uuid = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";
const validator = { $jsonSchema: { bsonType: "object", required: ["_id", "nonce"], additionalProperties: false,
  properties: { _id: { enum: ["write"] }, nonce: { bsonType: "string", pattern: uuid } } } };
function collection(store: MongoOperationStore) { return store.db.collection<{ _id: string; nonce: string }>(`${store.namespace}_InstructorNoteWriteGuard`); }
export async function prepareMongoInstructorNoteGuard(store: MongoOperationStore, allowShadowWrites: true) {
  assertMongo(allowShadowWrites === true, "SHADOW_WRITE_GATE"); const target = collection(store);
  const existing = await store.db.listCollections({ name: target.collectionName }, { nameOnly: false }).next();
  if (!existing) await store.db.createCollection(target.collectionName, { validator, validationLevel: "strict", validationAction: "error", collation: { locale: "simple" } });
  await assertMongoInstructorNoteGuardReady(store);
}
export async function assertMongoInstructorNoteGuardReady(store: MongoOperationStore) {
  const target = collection(store), info = await store.db.listCollections({ name: target.collectionName }, { nameOnly: false }).next();
  assertMongo(info && info.options?.validationLevel === "strict" && info.options?.validationAction === "error" && stableMongoValue(info.options.validator) === stableMongoValue(validator)
    && (!info.options.collation || info.options.collation.locale === "simple") && !info.options.capped, "INSTRUCTOR_NOTE_GUARD_NOT_READY");
  const indexes = await target.listIndexes().toArray(); assertMongo(indexes.some(index => index.name === "_id_" && JSON.stringify(index.key) === JSON.stringify({ _id: 1 }))
    && indexes.every(index => index.expireAfterSeconds === undefined), "INSTRUCTOR_NOTE_GUARD_NOT_READY");
}
export async function lockMongoInstructorNote(store: MongoOperationStore, session: ClientSession) {
  const result = await collection(store).updateOne({ _id: "write" }, { $set: { nonce: randomUUID() } }, { session, upsert: true });
  assertMongo(result.matchedCount === 1 || result.upsertedCount === 1, "INSTRUCTOR_NOTE_GUARD_FAILED");
}
