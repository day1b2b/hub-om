import { MongoOperationStore, applyMongoValidator, assertMongo, operationMongoIndexes, operationMongoValidator, stableMongoValue, type MongoOperationOptions } from "./mongoOperationStore";

export const TEAM_READ_MODELS = ["Member", "TeamUser"] as const;
export const COACH_READ_MODELS = [
  "Coach", "CoachField", "CoachFieldMaster", "CoachCurriculum", "CoachCurriculumMaster",
  "CoachEngagement", "CoachEngagementSchedule", "CoachSchedule", "CoachDayReservation",
  "CoachdbArchiveRow", "CoachdbArchiveSnapshot", "CoachPrivateProfile"
] as const;

/** Explicit shadow setup only. Repositories never call this while opening or reading. */
export async function prepareMongoReadStore(options: MongoOperationOptions & { allowShadowWrites: true }, models: readonly string[]): Promise<void> {
  assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
  const store = new MongoOperationStore(options, models);
  for (const model of store.models) {
    const collection = store.collection(model);
    await applyMongoValidator(store, model, operationMongoValidator(model));
    const indexes = operationMongoIndexes(model);
    if (indexes.length) await collection.createIndexes(indexes, { collation: { locale: "simple" } });
  }
  await assertMongoReadStoreReady(store);
}

/** Read-only readiness check; unrelated domains and operation counters are not required. */
export async function assertMongoReadStoreReady(store: MongoOperationStore): Promise<void> {
  for (const model of store.models) {
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
}
