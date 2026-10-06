import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mock, test } from "node:test";
import { withPrivacyDatabase } from "./database";
import { encryptField, decryptField } from "./fields";
import type { OmRequest } from "../data/omRequest/omRequestTypes";

type Row = Record<string, unknown>;
let database: object;
mock.module("@/lib/data/prisma", { namedExports: { getPrismaClient: () => database } });
const { previewOmAssignment, assignOmRequestAtomically, OmAssignmentConflict } = await import("../data/omRequest/omRequestAssignment");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = "fixture.manager@example.test";
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => value && typeof value === "object" && "in" in value
    ? (value.in as unknown[]).includes(row[key]) : row[key] === value);
}
function fixture() {
  let request: Row = { id: uuid(1), operationId: "fixture-round-1", assignedOm: encryptField("OmRequest", "assignedOm", "기존 담당"),
    team: "fixture-team", status: "배정완료", totalSessions: 2, sessions: encryptField("OmRequest", "sessions", [{ date: "2026-09-21" }, { date: "2026-09-22" }]), createdAt: new Date("2026-09-21T00:00:00Z") };
  let operations: Row[] = [2, 3].map((n, i) => ({ id: uuid(n), operationId: `fixture-round-${i + 1}`, roundNo: String(i + 1),
    omName: encryptField("OperationSession", "omName", "수동 담당"), omUserId: encryptField("OperationSession", "omUserId", "fixture-account"),
    operationStatus: i ? "DONE" : "ASSIGNMENT_PLANNED", updatedAt: new Date("2026-09-21T00:00:00Z"), deletedAt: null }));
  const history: Row[] = [1, 2, 3].map(n => ({ requestId: uuid(4), route: "/api/om-request", method: "POST", action: "create",
    targetId: uuid(n), targetType: n === 1 ? "om_requests" : "operation_sessions", changes: { om_name: { redacted: true } } }));
  let failWrite = false;
  const calls: Row[] = [];
  const db = withPrivacyDatabase({ async $transaction(run: (tx: object) => Promise<unknown>, options: unknown) {
    assert.deepEqual(options, { isolationLevel: "Serializable" });
    let nextRequest = structuredClone(request);
    const nextOperations = structuredClone(operations);
    const project = (row: Row | undefined, select?: Row) => !row ? null : structuredClone(select ? Object.fromEntries(Object.entries(row).filter(([key]) => select[key])) : row);
    const result = await run({
      omRequest: {
        findUnique: async () => structuredClone(nextRequest),
        update: async ({ data }: { data: Row }) => {
          calls.push(data);
          if (failWrite) throw new Error("fixture request failure");
          nextRequest = { ...nextRequest, ...data }; return structuredClone(nextRequest);
        }
      },
      operationSession: {
        findUnique: async ({ where, select }: { where: Row; select?: Row }) => project(nextOperations.find(row => matches(row, where)), select),
        findMany: async ({ where, select }: { where: Row; select?: Row }) => nextOperations.filter(row => matches(row, where)).map(row => project(row, select)),
        update: async ({ where, data }: { where: Row; data: Row }) => {
          calls.push(data);
          const row = nextOperations.find(row => matches(row, where))!;
          Object.assign(row, data, { updatedAt: new Date(Number(row.updatedAt) + 1) }); return structuredClone(row);
        }
      },
      activityChange: { findMany: async ({ where, select }: { where: Row; select?: Row }) => history.filter(row => matches(row, where)).map(row => project(row, select)) }
    });
    request = nextRequest; operations = nextOperations;
    return result;
  } });
  database = db;
  return { existing: { id: uuid(1), operationId: "fixture-round-1", assignedOm: "기존 담당", team: "fixture-team" } as OmRequest,
    raw: () => ({ request, operations }), calls, fail: () => { failWrite = true; } };
}
async function environment(run: () => Promise<void>) {
  const vars = ["PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ACTIVE_KEY_ID", "PII_ALLOW_PLAINTEXT_READS", "AUTH_SECRET", "DATABASE_URL", "OPERATION_DATA_SOURCE"] as const;
  const previous = Object.fromEntries(vars.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ACTIVE_KEY_ID: "fixture", PII_ALLOW_PLAINTEXT_READS: "false", AUTH_SECRET: randomBytes(32).toString("base64"), DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture", OPERATION_DATA_SOURCE: "prisma" });
  try { await run(); } finally { for (const key of vars) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
}

test("암호화된 일정·수동 담당자와 마스킹 감사기록에서도 미리보기→재배정→취소가 호환된다", async () => environment(async () => {
  const state = fixture();
  const preview = await previewOmAssignment(state.existing, "새 담당", actor);
  assert.equal(preview.count, 2);
  assert.equal(preview.operations[0].omName, "수동 담당");
  assert.ok(!preview.token.includes("담당") && !preview.token.includes(actor));
  const result = await assignOmRequestAtomically(state.existing, "새 담당", actor, preview.token);
  assert.equal(result.operationIds.length, 2);
  assert.ok(!JSON.stringify(state.calls).includes("새 담당"));
  for (const row of state.raw().operations) {
    assert.equal(decryptField("OperationSession", "omName", row.omName), "새 담당");
    assert.equal(row.omUserId, null);
  }
  assert.equal(state.raw().operations[1].operationStatus, "DONE");
  await assert.rejects(assignOmRequestAtomically(result.updated, "새 담당", actor, preview.token), OmAssignmentConflict);
  const cancel = await previewOmAssignment(result.updated, null, actor);
  await assignOmRequestAtomically(result.updated, null, actor, cancel.token);
  assert.equal(state.raw().request.assignedOm, null);
  assert.ok(state.raw().operations.every(row => row.omName === null && row.omUserId === null));
  assert.equal(state.raw().operations[1].operationStatus, "DONE");
}));

test("암호화 어댑터에서 요청 저장 실패 시 회차 암호문도 원상태로 롤백한다", async () => environment(async () => {
  const state = fixture();
  const before = structuredClone(state.raw());
  const preview = await previewOmAssignment(state.existing, "새 담당", actor);
  state.fail();
  await assert.rejects(assignOmRequestAtomically(state.existing, "새 담당", actor, preview.token), /fixture request failure/);
  assert.deepEqual(state.raw(), before);
}));
