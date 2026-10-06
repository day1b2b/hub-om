import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { blindIndex } from "../privacy/crypto";
import type { LectureFollowUpSentLog } from "../reminders/lectureFollowUpReminder";
import { assertMongo, stableMongoValue, type MongoOperationStore } from "./mongoOperationStore";

type SentLogRow = {
  _id: string;
  claimId: string;
  date: string;
  status: "claimed" | "sent";
  claimedAt: Date;
  sentAt?: Date;
};

const hex = "^[a-f0-9]{64}$";
const uuid = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";
const date = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";
export const lectureFollowUpSentLogValidator = { $jsonSchema: {
  bsonType: "object",
  required: ["_id", "claimId", "date", "status", "claimedAt"],
  additionalProperties: false,
  properties: {
    _id: { bsonType: "string", pattern: hex },
    claimId: { bsonType: "string", pattern: uuid },
    date: { bsonType: "string", pattern: date },
    status: { enum: ["claimed", "sent"] },
    claimedAt: { bsonType: "date" },
    sentAt: { bsonType: "date" }
  }
} };

function collection(store: MongoOperationStore) {
  return store.db.collection<SentLogRow>(`${store.namespace}_LectureFollowUpSentLog`);
}

function index(key: string): string {
  return blindIndex(key, "mongo:lecture-follow-up:sent-key");
}

export async function prepareMongoLectureFollowUpSentLog(store: MongoOperationStore, allowShadowWrites: true): Promise<void> {
  assertMongo(allowShadowWrites === true, "SHADOW_WRITE_GATE");
  const rows = collection(store);
  const existing = await store.db.listCollections({ name: rows.collectionName }, { nameOnly: false }).next();
  if (!existing) await store.db.createCollection(rows.collectionName, {
    validator: lectureFollowUpSentLogValidator,
    validationLevel: "strict",
    validationAction: "error",
    collation: { locale: "simple" }
  });
  await assertMongoLectureFollowUpSentLogReady(store);
}

export async function assertMongoLectureFollowUpSentLogReady(store: MongoOperationStore): Promise<void> {
  const rows = collection(store);
  const info = await store.db.listCollections({ name: rows.collectionName }, { nameOnly: false }).next();
  assertMongo(info && info.options?.validationLevel === "strict" && info.options?.validationAction === "error"
    && stableMongoValue(info.options.validator) === stableMongoValue(lectureFollowUpSentLogValidator)
    && (!info.options.collation || info.options.collation.locale === "simple") && !info.options.capped,
  "LECTURE_FOLLOW_UP_SENT_LOG_NOT_READY");
  const indexes = await rows.listIndexes().toArray();
  assertMongo(indexes.some(item => item.name === "_id_" && JSON.stringify(item.key) === JSON.stringify({ _id: 1 }))
    && indexes.every(item => item.expireAfterSeconds === undefined), "LECTURE_FOLLOW_UP_SENT_LOG_NOT_READY");
}

export class MongoLectureFollowUpSentLog implements LectureFollowUpSentLog {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(store: MongoOperationStore): Promise<MongoLectureFollowUpSentLog> {
    await assertMongoLectureFollowUpSentLogReady(store);
    return new MongoLectureFollowUpSentLog(store);
  }

  async recorded(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const pairs = keys.map(key => ({ key, id: index(key) }));
    const found = new Set((await collection(this.store).find({ _id: { $in: pairs.map(item => item.id) } }, { projection: { _id: 1 } }).toArray()).map(row => row._id));
    return new Set(pairs.filter(item => found.has(item.id)).map(item => item.key));
  }

  async claim(today: string, keys: string[]): Promise<string | null> {
    assertMongo(keys.length > 0, "REMINDER_EMPTY_CLAIM");
    const claimId = randomUUID();
    const claimedAt = new Date();
    const session = this.store.client.startSession();
    try {
      await session.withTransaction(async () => {
        await collection(this.store).insertMany(keys.map(key => ({
          _id: index(key), claimId, date: today, status: "claimed" as const, claimedAt
        })), { session, ordered: true });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary" });
      return claimId;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return null;
      throw error;
    } finally { await session.endSession(); }
  }

  async complete(claimId: string, _today: string, keys: string[]): Promise<void> {
    const result = await collection(this.store).updateMany(
      { _id: { $in: keys.map(index) }, claimId, status: "claimed" },
      { $set: { status: "sent", sentAt: new Date() } }
    );
    assertMongo(result.matchedCount === keys.length && result.modifiedCount === keys.length, "REMINDER_CLAIM_COMPLETE_FAILED");
  }

  async release(claimId: string): Promise<void> {
    await collection(this.store).deleteMany({ claimId, status: "claimed" });
  }
}
