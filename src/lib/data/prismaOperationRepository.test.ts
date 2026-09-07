import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import type { OperationSession, UpdateOperationInput } from "./operationTypes";

const sessionUpdate = mock.fn(async (args: { where: { operationId: string }; data: Record<string, unknown> }) => args);
const courseUpdate = mock.fn(async (args: unknown) => args);
const labelUpsert = mock.fn(async (args: unknown) => args);
const prisma = {
  operationSession: {
    findUnique: async () => ({ courseRecordId: "course-1", course: { companyId: "company-1", courseId: "course-id" } }),
    update: sessionUpdate
  },
  course: { update: courseUpdate },
  courseIdLabel: { upsert: labelUpsert }
};
mock.module("./prisma", { namedExports: { getPrismaClient: () => prisma } });
const { PrismaOperationRepository } = await import("./prismaOperationRepository");
const repository = new PrismaOperationRepository();
mock.method(repository, "getOperationById", async (): Promise<OperationSession> => ({ operationId: "OP-review" } as OperationSession));

beforeEach(() => {
  sessionUpdate.mock.resetCalls();
  courseUpdate.mock.resetCalls();
  labelUpsert.mock.resetCalls();
});

for (const [field, value] of [["courseIdLabel", "코스명"], ["courseCategory", "분류"], ["tools", "도구"]] as const) {
  test(`${field}만 바꿔도 관련 테이블과 함께 회차의 수정자를 기록한다`, async () => {
    await repository.updateOperation("OP-review", { [field]: value }, "editor@example.test");
    assert.equal(field === "courseIdLabel" ? labelUpsert.mock.callCount() : courseUpdate.mock.callCount(), 1);
    assert.equal(sessionUpdate.mock.callCount(), 1);
    assert.deepEqual(sessionUpdate.mock.calls[0].arguments[0], {
      where: { operationId: "OP-review" }, data: { updatedBy: "editor@example.test" }
    });
  });
}

test("관련 필드를 비우는 수정도 수정자를 기록한다", async () => {
  await repository.updateOperation("OP-review", { courseIdLabel: "", tools: "" }, "editor@example.test");
  assert.equal(labelUpsert.mock.callCount(), 1);
  assert.equal(courseUpdate.mock.callCount(), 1);
  assert.equal(sessionUpdate.mock.calls[0].arguments[0].data.updatedBy, "editor@example.test");
});

test("회차 필드와 관련 필드를 함께 수정할 때 데이터와 수정자를 함께 쓴다", async () => {
  await repository.updateOperation("OP-review", { lectureManagementNote: "기록", tools: "도구" }, "editor@example.test");
  assert.deepEqual(sessionUpdate.mock.calls[0].arguments[0].data, { lectureManagementNote: "기록", updatedBy: "editor@example.test" });
});

test("실제 수정 항목이 없으면 수정자만 덮어쓰지 않는다", async () => {
  await repository.updateOperation("OP-review", {}, "editor@example.test");
  assert.equal(sessionUpdate.mock.callCount(), 0);
  assert.equal(courseUpdate.mock.callCount(), 0);
  assert.equal(labelUpsert.mock.callCount(), 0);
});

test("수정자를 전달하지 않는 기존 호출은 이전 수정자를 덮어쓰지 않는다", async () => {
  const input: UpdateOperationInput = { tools: "도구" };
  await repository.updateOperation("OP-review", input);
  assert.equal(courseUpdate.mock.callCount(), 1);
  assert.equal(sessionUpdate.mock.callCount(), 0);
});
