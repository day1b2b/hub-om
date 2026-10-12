import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { MongoClient } from "mongodb";
import { getDataRepositoryOverride, registerDataRepositoryScope, runWithDataRepositories } from "./dataRepositoryContext";
import type { MongoCalendarRepositories } from "./mongoCalendarRuntime";

let original: MongoCalendarRepositories;
mock.module("./mongoCalendarRuntime", { namedExports: { openMongoCalendarRuntime: async () => {
  original = Object.freeze(Object.fromEntries(["operations", "omRequests", "teamUsers", "teamMembers", "importPromotion",
    "importPromotionCalendar", "requestActivity", "calendarPersistence", "calendarLock"].map(key => [key, {}]))) as MongoCalendarRepositories;
  registerDataRepositoryScope(original);
  return { repositories: original };
} } });
const { MongoCourseAdminRepository } = await import("./mongoCourseAdminRepository");
const { openMongoCourseDeletionRuntime } = await import("./courseDeletionComposition");

test("course deletion preserves Calendar repository identities and fails closed on a partial scope", async () => {
  const opened = mock.method(MongoCourseAdminRepository, "open", async () => ({}));
  try {
    const runtime = await openMongoCourseDeletionRuntime({ client: {} as MongoClient,
      databaseName: "hub_om_shadow_course_delete", namespace: "shadow_delete", allowShadowWrites: true });
    for (const key of Object.keys(original) as Array<keyof MongoCalendarRepositories>) assert.equal(runtime.repositories[key], original[key]);
    runtime.run(() => assert.equal(getDataRepositoryOverride("courseAdmin"), runtime.repositories.courseAdmin));
    assert.throws(() => runWithDataRepositories({ ...runtime.repositories, calendarLock: undefined }, () => {}), /CALENDAR_SCOPE_MISMATCH/);
  } finally { opened.mock.restore(); }
});
