import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

interface FixtureOperation {
  companyName: string;
  courseId: string;
  courseName: string;
  om: string;
  operationId: string;
  operationStatus: string;
}

let operations: FixtureOperation[];
const updates: Array<{ operationId: string; patch: Record<string, unknown> }> = [];

mock.module("@/lib/data/operationCalculations", {
  namedExports: {
    ASSIGNMENT_NEEDED_VALUES: new Set(["★배정필요", "배정필요"]),
    isSameCourse: (a: FixtureOperation, b: FixtureOperation) =>
      a.courseId === b.courseId && a.courseName === b.courseName && a.companyName === b.companyName,
    parseEducationDatesText: () => ({ dates: [], errors: [] })
  }
});

mock.module("@/lib/data/operationRepositoryFactory", {
  namedExports: {
    getOperationRepository: () => ({
      getOperationById: async (operationId: string) => operations.find((op) => op.operationId === operationId) ?? null,
      listOperations: async () => [...operations],
      updateOperation: async (operationId: string, patch: Record<string, unknown>) => {
        const target = operations.find((op) => op.operationId === operationId)!;
        Object.assign(target, patch);
        updates.push({ operationId, patch });
        return target;
      }
    })
  }
});

const { syncAssignedOmToLinkedOperation } = await import("./omRequestOperationLink");

beforeEach(() => {
  updates.length = 0;
  operations = [
    { operationId: "round-1", courseId: "c1", courseName: "AI 기초", companyName: "테스트기업", om: "", operationStatus: "배정필요" },
    { operationId: "round-2", courseId: "c1", courseName: "AI 기초", companyName: "테스트기업", om: "", operationStatus: "배정필요" },
    { operationId: "round-3", courseId: "c1", courseName: "AI 기초", companyName: "테스트기업", om: "박현우", operationStatus: "배정예정" },
    { operationId: "other-course", courseId: "c2", courseName: "다른 과정", companyName: "테스트기업", om: "", operationStatus: "배정필요" }
  ];
});

test("같은 과정에서 OM이 비어있는 다른 회차에도 배정 결과를 전파한다", async () => {
  await syncAssignedOmToLinkedOperation("round-1", "김정선");

  assert.equal(operations[0].om, "김정선");
  assert.equal(operations[0].operationStatus, "배정예정");
  assert.equal(operations[1].om, "김정선");
  assert.equal(operations[1].operationStatus, "배정예정");
});

test("이미 다른 OM이 개별 지정된 회차는 덮어쓰지 않는다", async () => {
  await syncAssignedOmToLinkedOperation("round-1", "김정선");

  assert.equal(operations[2].om, "박현우");
  assert.equal(operations[2].operationStatus, "배정예정");
});

test("다른 과정의 회차는 건드리지 않는다", async () => {
  await syncAssignedOmToLinkedOperation("round-1", "김정선");

  assert.equal(operations[3].om, "");
});

test("대표 회차는 자기 자신 값과 무관하게 항상 갱신한다", async () => {
  operations[0].om = "★배정필요";
  await syncAssignedOmToLinkedOperation("round-1", "김정선");

  const roundOneUpdate = updates.find((entry) => entry.operationId === "round-1");
  assert.ok(roundOneUpdate);
  assert.equal(operations[0].om, "김정선");
});
