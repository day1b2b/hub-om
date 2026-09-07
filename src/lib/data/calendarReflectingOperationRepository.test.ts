import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import type { OperationRepository } from "./operationRepository";
import type { OperationSession, UpdateOperationInput } from "./operationTypes";
const reflected = mock.fn(async () => {});
mock.module("@/lib/googleCalendar/reflectOperationToCalendar", { namedExports: {
  reflectOperationCreated: async () => {}, reflectOperationUpdated: reflected, reflectOperationDelete: async () => {}
} });
const { CalendarReflectingOperationRepository } = await import("./calendarReflectingOperationRepository");
const saved = { operationId: "fixture" } as OperationSession;
const update = mock.fn(async () => saved);
const repository = new CalendarReflectingOperationRepository({ updateOperation: update } as unknown as OperationRepository);
beforeEach(() => { reflected.mock.resetCalls(); update.mock.resetCalls(); });
for (const input of [{ educationDates: ["2026-09-09"] }, { educationDates: [] }, { instructors: "테스트 강사" }]) {
  test(`${Object.keys(input)[0]}만 수정해도 캘린더를 갱신한다`, async () => {
    assert.equal(await repository.updateOperation("fixture", input as UpdateOperationInput), saved);
    assert.equal(reflected.mock.callCount(), 1);
  });
}
test("비용만 수정하면 캘린더를 호출하지 않는다", async () => {
  await repository.updateOperation("fixture", { costRaw: "100" });
  assert.equal(update.mock.callCount(), 1); assert.equal(reflected.mock.callCount(), 0);
});
