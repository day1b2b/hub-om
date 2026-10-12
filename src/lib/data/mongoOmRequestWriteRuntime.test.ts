import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { MongoClient } from "mongodb";
import { getDataRepositoryOverride, registerDataRepositoryScope, runWithDataRepositories } from "./dataRepositoryContext";
import type { MongoCalendarRepositories } from "./mongoCalendarRuntime";

let calendarRepositories: MongoCalendarRepositories;
mock.module("./mongoCalendarRuntime", { namedExports: {
  openMongoCalendarRuntime: async () => {
    calendarRepositories = Object.freeze(Object.fromEntries([
      "operations", "omRequests", "teamUsers", "teamMembers", "importPromotion",
      "importPromotionCalendar", "requestActivity", "calendarPersistence", "calendarLock"
    ].map(key => [key, {}]))) as MongoCalendarRepositories;
    registerDataRepositoryScope(calendarRepositories);
    return { repositories: calendarRepositories };
  },
  prepareMongoCalendarRuntimeStore: async () => {}
} });
const assignmentModule = await import("./mongoOmAssignmentRepository");
const requestModule = await import("./mongoOmRequestRepository");
const { openMongoOmRequestWriteRuntime } = await import("./mongoOmRequestWriteRuntime");

test("OM write runtime preserves the registered Calendar repositories and rejects mixed scopes", async () => {
  const assignment = mock.method(assignmentModule.MongoOmAssignmentRepository, "open", async () => ({}));
  const extraRequest = mock.method(requestModule.MongoOmRequestRepository, "open", async () => ({}));
  try {
    const runtime = await openMongoOmRequestWriteRuntime({
      client: { db: () => ({}) } as unknown as MongoClient,
      databaseName: "hub_om_shadow_scope_regression", namespace: "shadow_scope_regression", allowShadowWrites: true,
      omAssignmentCalendar: { async reflectOperationUpdated() {} },
      omAssignmentNotifier: { async notifyAssigned() {} },
      omCustomTools: { list: () => [], add: () => {} },
      omRequestNotifier: { async notifyCreated() { return null; } }
    });
    assert.equal(extraRequest.mock.callCount(), 0);
    for (const key of Object.keys(calendarRepositories) as Array<keyof MongoCalendarRepositories>) {
      assert.equal(runtime.repositories[key], calendarRepositories[key]);
    }
    let calls = 0;
    runtime.run(() => {
      assert.equal(getDataRepositoryOverride("omRequests"), calendarRepositories.omRequests);
      calls++;
    });
    assert.equal(calls, 1);
    assert.equal(getDataRepositoryOverride("omRequests"), undefined);
    assert.throws(() => runWithDataRepositories({ ...runtime.repositories, omRequests: {} as typeof runtime.repositories.omRequests }, () => { calls++; }), /CALENDAR_SCOPE_MISMATCH/);
    const partial = { ...runtime.repositories, omRequests: undefined };
    assert.throws(() => runWithDataRepositories(partial, () => { calls++; }), /CALENDAR_SCOPE_MISMATCH/);
    assert.equal(calls, 1);
  } finally {
    assignment.mock.restore(); extraRequest.mock.restore();
  }
});
