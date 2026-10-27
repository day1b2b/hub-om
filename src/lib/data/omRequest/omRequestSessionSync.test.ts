import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

interface FixtureOperation {
  companyName: string;
  courseId: string;
  courseName: string;
  deleted?: boolean;
  operationId: string;
  roundNo: string;
}

let operations: FixtureOperation[];
let createdCount = 0;
let failCreateAt = 0;
const calls: string[] = [];

mock.module("@/lib/data/operationCalculations", {
  namedExports: {
    ASSIGNMENT_NEEDED_VALUES: new Set(["배정필요"]),
    isSameCourse: (a: FixtureOperation, b: FixtureOperation) =>
      a.courseId === b.courseId && a.courseName === b.courseName && a.companyName === b.companyName,
    parseEducationDatesText: () => ({ dates: [], errors: [] })
  }
});

mock.module("@/lib/data/operationRepositoryFactory", {
  namedExports: {
    getOperationRepository: () => ({
      getOperationById: async (operationId: string) => operations.find((op) => op.operationId === operationId && !op.deleted) ?? null,
      listOperations: async () => operations.filter((op) => !op.deleted),
      createOperation: async (input: FixtureOperation) => {
        if (createdCount + 1 === failCreateAt) throw new Error("SYNTHETIC_CREATE_FAILED");
        const operation = { ...input, operationId: `new-${++createdCount}` };
        operations.push(operation);
        calls.push(`create:${operation.operationId}:${input.roundNo}`);
        return operation;
      },
      deleteOperation: async (operationId: string) => {
        operations.find((op) => op.operationId === operationId)!.deleted = true;
        calls.push(`delete:${operationId}`);
      },
      updateOperation: async (operationId: string, patch: Partial<FixtureOperation>) => {
        const target = operations.find((op) => op.operationId === operationId)!;
        Object.assign(target, patch);
        if (patch.roundNo) calls.push(`renumber:${operationId}:${patch.roundNo}`);
        if ((patch as { startDate?: string }).startDate) calls.push(`schedule:${operationId}:${(patch as { startDate?: string }).startDate}:${(patch as { region?: string }).region}`);
        return target;
      }
    })
  }
});

const { createLinkedOperationForOmRequest, syncOmRequestSessionsToOperations } = await import("./omRequestOperationLink");
const { planSessionCountChange } = await import("./omRequestSessionPlan");

const session = (date: string) => ({ date, timeStart: "09:00", timeEnd: "18:00", duration: "8", location: "합성 장소" });
const request = (count: number) => ({
  id: "synthetic-request", createdAt: "", status: "배정필요" as const, operationId: "round-1", team: "1파트", ld: "합성 LD",
  company: "합성기업", trainingType: "오프라인" as const, courseId: "", courseName: "합성 과정", courseCategory: "", instructorName: "",
  syncupLink: "", driveLink: "", skillfloSetup: "N" as const, skillmatchSetup: "N" as const, onSiteOperation: "N" as const,
  coachRequest: "N" as const, resultReportNeeded: "Y" as const, totalSessions: count,
  sessions: Array.from({ length: count }, (_, i) => session(`2099-01-0${i + 1}`)), notes: ""
});
const round = (n: number): FixtureOperation => ({ operationId: `round-${n}`, roundNo: String(n), companyName: "합성기업", courseId: "", courseName: "합성 과정" });

beforeEach(() => {
  createdCount = 0;
  failCreateAt = 0;
  calls.length = 0;
  operations = [round(1), round(2), round(3), { ...round(9), courseName: "다른 과정" }];
});

test("고른 가운데 회차만 지우고 남은 회차 번호를 1부터 다시 매긴다", async () => {
  const next = { ...request(2), sessions: [session("2099-01-01"), session("2099-01-03")] };
  const first = await syncOmRequestSessionsToOperations(request(3), next, [0, 2]);
  assert.equal(first, "round-1");
  assert.deepEqual(calls, ["delete:round-2", "renumber:round-3:2"]);
  assert.equal(operations.find((op) => op.operationId === "round-9")!.deleted, undefined);
});

test("추가한 회차는 운영현황 회차를 새로 만들고 지우는 것보다 먼저 만든다", async () => {
  const next = { ...request(3), sessions: [session("2099-01-02"), session("2099-01-03"), session("2099-01-09")] };
  const first = await syncOmRequestSessionsToOperations(request(3), next, [1, 2, null]);
  assert.deepEqual(calls, ["create:new-1:3", "delete:round-1", "renumber:round-2:1", "renumber:round-3:2"]);
  assert.equal(first, "round-2");
});

test("남은 회차 중 일정이 바뀐 회차만 운영현황 일정을 고친다", async () => {
  const before = request(3);
  const next = { ...request(3), sessions: [before.sessions[0], { ...session("2099-02-02"), location: "바뀐 장소" }, before.sessions[2]] };
  await syncOmRequestSessionsToOperations(before, next, [0, 1, 2]);
  assert.deepEqual(calls, ["schedule:round-2:2099-02-02:바뀐 장소"]);
});

test("운영현황 회차 수가 요청과 다르면 아무것도 바꾸지 않고 거절한다", async () => {
  operations.push(round(4));
  await assert.rejects(syncOmRequestSessionsToOperations(request(3), request(2), [0, 1]), /OPERATION_ROUND_MISMATCH/);
  assert.deepEqual(calls, []);
});

test("추가할 회차를 만들다 실패하면 이번에 만든 회차만 지우고 기존 회차는 그대로 둔다", async () => {
  failCreateAt = 2;
  await assert.rejects(syncOmRequestSessionsToOperations(request(3), request(5), [0, 1, 2, null, null]), /SYNTHETIC_CREATE_FAILED/);
  assert.deepEqual(calls, ["create:new-1:4", "delete:new-1"]);
  assert.deepEqual(operations.filter((op) => !op.deleted).map((op) => op.operationId), ["round-1", "round-2", "round-3", "round-9"]);
});

test("접수 때 회차를 만들다 실패하면 앞서 만든 회차를 역순으로 지우고 실패를 알린다", async () => {
  operations = [];
  failCreateAt = 3;
  await assert.rejects(createLinkedOperationForOmRequest(request(3)), /SYNTHETIC_CREATE_FAILED/);
  assert.deepEqual(calls, ["create:new-1:1", "create:new-2:2", "delete:new-2", "delete:new-1"]);
  assert.deepEqual(operations.filter((op) => !op.deleted), []);
});

test("접수 때 모든 회차를 만들면 1회차를 대표로 돌려준다", async () => {
  operations = [];
  assert.equal(await createLinkedOperationForOmRequest(request(2)), "new-1");
  assert.deepEqual(calls, ["create:new-1:1", "create:new-2:2"]);
});

test("교육일이 빠졌거나 총 회차와 회차 수가 다르면 만들기 전에 거절한다", async () => {
  operations = [];
  const missingDate = { ...request(2), sessions: [session("2099-01-01"), { ...session(""), educationDatesText: "1/2" }] };
  await assert.rejects(createLinkedOperationForOmRequest(missingDate), /OM_REQUEST_SESSION_INPUT_INVALID/);
  await assert.rejects(createLinkedOperationForOmRequest({ ...request(2), totalSessions: 3 }), /OM_REQUEST_SESSION_INPUT_INVALID/);
  assert.deepEqual(calls, []);
});

test("회차 계획은 고른 회차만 지우고 순서 바꾸기는 받지 않는다", () => {
  assert.deepEqual(planSessionCountChange(3, 2, [0, 2]), { ok: true, changed: true, removedIndexes: [1], origins: [0, 2] });
  assert.deepEqual(planSessionCountChange(2, 3, [0, 1, null]), { ok: true, changed: true, removedIndexes: [], origins: [0, 1, null] });
  const unchanged = planSessionCountChange(2, 2, [0, 1]);
  assert.equal(unchanged.ok && unchanged.changed, false);
  for (const origins of [[1, 0], [0, 0], [0, 5], [0], "0,1"]) assert.equal(planSessionCountChange(2, 2, origins).ok, false);
  assert.equal(planSessionCountChange(2, 1, undefined).ok, false);
  assert.equal(planSessionCountChange(2, 2, undefined).ok, true);
});
