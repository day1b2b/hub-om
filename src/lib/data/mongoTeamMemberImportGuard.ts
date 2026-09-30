import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { assertMongo, stableMongoValue, type MongoOperationStore } from "./mongoOperationStore";

const uuid = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";
export const teamMemberImportGuardValidator = { $jsonSchema: { bsonType: "object", required: ["_id", "nonce"], additionalProperties: false,
  properties: { _id: { enum: ["import"] }, nonce: { bsonType: "string", pattern: uuid } } } };
export function teamMemberImportGuardCollection(store: MongoOperationStore) {
  return store.db.collection<{ _id: string; nonce: string }>(`${store.namespace}_TeamMemberImportGuard`);
}
export async function prepareMongoTeamMemberImportGuard(store: MongoOperationStore, allowShadowWrites: true) {
  assertMongo(allowShadowWrites === true, "SHADOW_WRITE_GATE"); const collection = teamMemberImportGuardCollection(store);
  const existing = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  if (!existing) await store.db.createCollection(collection.collectionName, { validator: teamMemberImportGuardValidator, validationLevel: "strict", validationAction: "error", collation: { locale: "simple" } });
  await assertMongoTeamMemberImportGuardReady(store);
}
export async function assertMongoTeamMemberImportGuardReady(store: MongoOperationStore) {
  const collection = teamMemberImportGuardCollection(store), info = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  assertMongo(info && info.options?.validationLevel === "strict" && info.options?.validationAction === "error"
    && stableMongoValue(info.options.validator) === stableMongoValue(teamMemberImportGuardValidator)
    && (!info.options.collation || info.options.collation.locale === "simple") && !info.options.capped, "TEAM_MEMBER_IMPORT_GUARD_NOT_READY");
  const indexes = await collection.listIndexes().toArray();
  assertMongo(indexes.some(index => index.name === "_id_" && JSON.stringify(index.key) === JSON.stringify({ _id: 1 }))
    && indexes.every(index => index.expireAfterSeconds === undefined), "TEAM_MEMBER_IMPORT_GUARD_NOT_READY");
}
export async function lockMongoTeamMemberImport(store: MongoOperationStore, session: ClientSession) {
  const result = await teamMemberImportGuardCollection(store).updateOne({ _id: "import" }, { $set: { nonce: randomUUID() } }, { session, upsert: true });
  assertMongo(result.matchedCount === 1 || result.upsertedCount === 1, "TEAM_MEMBER_IMPORT_GUARD_FAILED");
}
