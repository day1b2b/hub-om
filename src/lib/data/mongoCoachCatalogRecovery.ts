import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoCoachCatalogGuardReady, coachCatalogGuardCollection, prepareMongoCoachCatalogGuard } from "./mongoCoachCatalogGuard";
import { assertMongoCoachSchedulingGuardReady } from "./mongoCoachSchedulingGuard";
import { assertMongoLectureFollowUpSentLogReady, prepareMongoLectureFollowUpSentLog } from "./mongoLectureFollowUpSentLog";
import { assertMongoTeamMemberImportGuardReady, prepareMongoTeamMemberImportGuard } from "./mongoTeamMemberImportGuard";

/** Read-only by default. Only the missing internal collection can be created. */
export async function recoverMongoCoachCatalog(options: MongoOperationOptions, apply = false) {
  const store = new MongoOperationStore(options);
  // Refuse a typo/empty namespace before creating anything.
  await assertMongoCoachSchedulingGuardReady(store);
  for (const model of ["Coach", "CoachContentEntry", "CoachEngagement"]) {
    if (!await store.db.listCollections({ name: `${store.namespace}_${model}` }).hasNext()) throw new Error("COACH_RECOVERY_NAMESPACE_INCOMPLETE");
  }
  const exists = await store.db.listCollections({ name: coachCatalogGuardCollection(store).collectionName }).hasNext();
  if (exists) await assertMongoCoachCatalogGuardReady(store);
  else if (apply) await prepareMongoCoachCatalogGuard(store, true);
  return { ready: exists || apply, missing: !exists, created: !exists && apply };
}

/** Other open-only internal structures missing from production. Same rule: create only when absent, never repair. */
export async function recoverMongoInternalStructures(options: MongoOperationOptions, apply = false) {
  const store = new MongoOperationStore(options);
  const items = [
    { name: "LectureFollowUpSentLog", prepare: () => prepareMongoLectureFollowUpSentLog(store, true), assert: () => assertMongoLectureFollowUpSentLogReady(store) },
    { name: "TeamMemberImportGuard", prepare: () => prepareMongoTeamMemberImportGuard(store, true), assert: () => assertMongoTeamMemberImportGuardReady(store) },
  ];
  const results = [];
  for (const item of items) {
    const exists = await store.db.listCollections({ name: `${store.namespace}_${item.name}` }).hasNext();
    if (exists) await item.assert();
    else if (apply) await item.prepare();
    results.push({ name: item.name, ready: exists || apply, missing: !exists, created: !exists && apply });
  }
  return results;
}
