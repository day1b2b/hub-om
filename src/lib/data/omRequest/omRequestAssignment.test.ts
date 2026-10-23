import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import type { OmRequest } from "./omRequestTypes";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const requestId = id(1), batchId = id(2);
const actor = "manager@example.invalid";
const savedEnv = { database: process.env.DATABASE_URL, source: process.env.OPERATION_DATA_SOURCE, secret: process.env.AUTH_SECRET, legacySecret: process.env.NEXTAUTH_SECRET };
const originalNow = Date.now;
let now = new Date("2026-09-21T00:00:00Z").getTime();
Date.now = () => now;
process.env.DATABASE_URL = "postgresql://fixture:fixture@invalid/fixture";
process.env.OPERATION_DATA_SOURCE = "prisma";
process.env.AUTH_SECRET = "assignment-fixture-secret-not-a-real-key";
delete process.env.NEXTAUTH_SECRET;
after(() => {
  Date.now = originalNow;
  for (const [key, value] of Object.entries({ DATABASE_URL: savedEnv.database, OPERATION_DATA_SOURCE: savedEnv.source, AUTH_SECRET: savedEnv.secret, NEXTAUTH_SECRET: savedEnv.legacySecret })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
type Operation = { id: string; operationId: string; roundNo: string; omName: string | null; omUserId: string | null; operationStatus: string; updatedAt: Date; deletedAt: Date | null };
type Creation = { requestId: string; route: string; method: string; action: string; targetType: string; targetId: string; occurredAt: Date; changes?: unknown };
// Audit rows get increasing times in the order a test records them.
let clock = 0;
const at = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000);
const operation = (number: number, omName: string | null = `수동 담당 ${number}`): Operation => ({ id: id(number), operationId: `round-${number}`, roundNo: String(number - 10), omName, omUserId: id(number + 100), operationStatus: "ASSIGNMENT_PLANNED", updatedAt: new Date(0), deletedAt: null });
const creation = (targetType: string, targetId: string, request = batchId): Creation => ({ requestId: request, route: "/api/om-request", method: "POST", action: "create", targetType, targetId, occurredAt: at(), changes: { om_name: { redacted: true } } });
let row: { id: string; team: string; status: string; assignedOm: string | null; operationId: string | null; totalSessions: number; sessions: Array<{ date: string; location?: string }>; createdAt: Date };
let operations: Operation[];
let history: Creation[];
let writes: string[];
let operationFailure = false;
let requestFailure = false;
let commitFailure: Error | null = null;
function existing(): OmRequest {
  return { ...row, assignedOm: row.assignedOm ?? undefined, operationId: row.operationId ?? undefined, createdAt: row.createdAt.toISOString() } as OmRequest;
}
function matches(entry: Creation, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = entry[key as keyof Creation];
    return value && typeof value === "object" && "in" in value ? (value.in as unknown[]).includes(actual) : actual === value;
  });
}
mock.module("@/lib/data/prisma", { namedExports: { getPrismaClient: () => ({
  $transaction: async (run: (tx: unknown) => Promise<unknown>, options: unknown) => {
    assert.deepEqual(options, { isolationLevel: "Serializable" });
    const snapshot = structuredClone({ row, operations, writes });
    try {
      const result = await run({
        omRequest: {
          findUnique: async () => structuredClone(row),
          update: async ({ data }: { data: Partial<typeof row> }) => { writes.push("request"); if (requestFailure) throw new Error("fixture request failure"); Object.assign(row, data); }
        },
        operationSession: {
          findUnique: async ({ where }: { where: { operationId: string } }) => structuredClone(operations.find((op) => op.operationId === where.operationId) ?? null),
          findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
            assert.deepEqual(Object.keys(where), ["id"], "course/name expansion must never be used");
            return structuredClone(operations.filter((op) => where.id.in.includes(op.id)));
          },
          update: async ({ where, data }: { where: { id: string }; data: Partial<Operation> }) => {
            writes.push(where.id);
            if (operationFailure && writes.length === 2) throw new Error("fixture operation failure");
            Object.assign(operations.find((op) => op.id === where.id)!, data, { updatedAt: new Date(now) });
          }
        },
        activityChange: { findMany: async ({ where, select }: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
          assert.ok(!("changes" in select), "audit change values must never be read");
          return structuredClone(history.filter((entry) => matches(entry, where)));
        } }
      });
      if (commitFailure) throw commitFailure;
      return result;
    } catch (error) { row = snapshot.row; operations = snapshot.operations; writes = snapshot.writes; throw error; }
  }
}) } });
const { previewOmAssignment, assignOmRequestAtomically, OmAssignmentConflict } = await import("./omRequestAssignment");
const preview = (next: string | null = "새 담당") => previewOmAssignment(existing(), next, actor);
const assign = (token: string, next: string | null = "새 담당", user = actor) => assignOmRequestAtomically(existing(), next, user, token);
beforeEach(() => {
  now = new Date("2026-09-21T00:00:00Z").getTime();
  process.env.OPERATION_DATA_SOURCE = "prisma";
  process.env.AUTH_SECRET = "assignment-fixture-secret-not-a-real-key";
  delete process.env.NEXTAUTH_SECRET;
  row = { id: requestId, team: "fixture-team", status: "배정완료", assignedOm: "이전 담당", operationId: "round-11", totalSessions: 2,
    sessions: [{ date: "2026-10-01" }, { date: "2026-10-02" }], createdAt: new Date(0) };
  operations = [operation(11), operation(12), operation(13, "다른 요청 담당")];
  history = [creation("om_requests", requestId), creation("operation_sessions", id(11)), creation("operation_sessions", id(12)), creation("om_requests", id(99), id(98)), creation("operation_sessions", id(13), id(98))];
  writes = []; operationFailure = false; requestFailure = false; commitFailure = null;
});

test("가려진 감사값으로도 정확한 생성 연결만 미리보고 개인정보 없는 10분 토큰을 발급한다", async () => {
  const result = await preview();
  assert.equal(result.count, 2);
  assert.deepEqual(result.operations.map((op) => op.operationId), ["round-11", "round-12"]);
  assert.equal(result.assignedOm, "이전 담당");
  assert.equal(result.nextOm, "새 담당");
  assert.match(result.token, /^\d{13}\.[0-9a-f]{64}$/);
  assert.equal(Number(result.token.split(".")[0]), now + 600_000);
  for (const value of [actor, requestId, "새 담당", "이전 담당", "round-11"]) assert.ok(!result.token.includes(value));
  assert.deepEqual(writes, []);
});
test("확인 후 수동 이름/ID를 모두 변경하고 무관한 같은 과정 회차는 그대로 둔다", async () => {
  operations[1].operationStatus = "DONE";
  const result = await assign((await preview()).token);
  assert.deepEqual(result.operationIds, ["round-11", "round-12"]);
  assert.equal(row.assignedOm, "새 담당");
  assert.deepEqual(operations.slice(0, 2).map((op) => [op.omName, op.omUserId]), [["새 담당", null], ["새 담당", null]]);
  assert.equal(operations[1].operationStatus, "DONE");
  assert.equal(operations[2].omName, "다른 요청 담당");
});
test("배정 취소는 ID도 비우고 예정만 필요로 되돌리며 완료 상태는 유지한다", async () => {
  operations[1].operationStatus = "DONE";
  await assign((await preview(null)).token, null);
  assert.equal(row.assignedOm, null);
  assert.equal(row.status, "배정필요");
  assert.deepEqual(operations.slice(0, 2).map((op) => [op.omName, op.omUserId, op.operationStatus]), [[null, null, "ASSIGNMENT_NEEDED"], [null, null, "DONE"]]);
});
test("필요에서 최초 배정은 예정으로, 동일값 확인 재시도는 추가 쓰기/반영 대상이 없다", async () => {
  for (const op of operations.slice(0, 2)) Object.assign(op, { omName: null, omUserId: null, operationStatus: "ASSIGNMENT_NEEDED" });
  await assign((await preview()).token);
  assert.equal(operations[0].operationStatus, "ASSIGNMENT_PLANNED");
  const noOp = await preview();
  writes = [];
  assert.deepEqual((await assign(noOp.token)).operationIds, []);
  assert.deepEqual((await assign(noOp.token)).operationIds, []);
  assert.deepEqual(writes, []);
});
test("토큰 형식/서명/유효기한 변조와 만료는 어떤 쓰기도 하지 않는다", async () => {
  const { token } = await preview();
  const alteredDigest = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
  for (const candidate of ["", "null", token + ".extra", alteredDigest, token.replace(/^\d+/, String(now + 600_001)), token.toUpperCase()]) {
    await assert.rejects(assign(candidate), OmAssignmentConflict);
    assert.deepEqual(writes, []);
  }
  now += 600_000;
  await assert.rejects(assign(token), OmAssignmentConflict);
  assert.deepEqual(writes, []);
});
test("토큰은 로그인 주체와 새 담당자에 묶인다", async () => {
  const { token } = await preview();
  await assert.rejects(assign(token, "새 담당", "different@example.invalid"), OmAssignmentConflict);
  await assert.rejects(assign(token, "변경 담당"), OmAssignmentConflict);
  await assert.rejects(assign(token, null), OmAssignmentConflict);
  await assert.rejects(assign(token, "새 담당", ""), OmAssignmentConflict);
  assert.deepEqual(writes, []);
});
test("팀/요청 배정/상태/일정과 대상 OM/ID/상태/갱신시각 변경은 확인을 무효화한다", async () => {
  const mutations = [
    () => { row.team = "changed-team"; }, () => { row.assignedOm = "changed"; }, () => { row.status = "배정필요"; },
    () => { row.sessions[0].location = "새 장소"; }, () => { operations[0].omName = "changed"; },
    () => { operations[0].omUserId = id(999); }, () => { operations[0].operationStatus = "ACTIVE"; },
    () => { operations[0].updatedAt = new Date(1); }, () => { operations[0].roundNo = "changed"; }
  ];
  for (const mutate of mutations) {
    const { token } = await preview();
    const snapshot = structuredClone({ row, operations });
    mutate();
    await assert.rejects(assign(token), OmAssignmentConflict);
    assert.deepEqual(writes, []);
    row = snapshot.row; operations = snapshot.operations;
  }
});
test("회차 추가·삭제·대표 연결 교체도 미리보기 뒤 저장 전에 차단한다", async () => {
  const { token } = await preview();
  operations[0].deletedAt = new Date(now);
  await assert.rejects(assign(token), OmAssignmentConflict);
  operations[0].deletedAt = null;
  row.operationId = "round-12";
  await assert.rejects(assign(token), OmAssignmentConflict);
  row.operationId = "round-11";
  row.totalSessions = 3; row.sessions.push({ date: "2026-10-03" });
  history.push(creation("operation_sessions", id(13)));
  await assert.rejects(assign(token), OmAssignmentConflict);
  assert.deepEqual(writes, []);
});
test("잘못된 총 회차수·일정·미연결·누락/삭제된 대표 회차는 구체적409 대상이다", async () => {
  row.totalSessions = 3;
  await assert.rejects(preview(), /총 회차 수/);
  row.totalSessions = 2; row.sessions[1].date = "";
  await assert.rejects(preview(), /총 회차 수/);
  row.sessions[1].date = "2026-10-02"; row.operationId = null;
  await assert.rejects(preview(), /연결 회차를 확인할 수 없어 변경하지 않았습니다/);
  row.operationId = "not-found";
  await assert.rejects(preview(), /대표 회차/);
  row.operationId = "round-11"; operations[0].deletedAt = new Date(now);
  await assert.rejects(preview(), /대표 회차/);
  assert.deepEqual(writes, []);
});
test("생성 감사 누락·다른 요청·배치 혼합·중복·잘못된 method/action은 연결 근거가 아니다", async () => {
  const original = structuredClone(history);
  const malformed = [
    original.slice(1),
    original.map((entry, index) => index === 2 ? { ...entry, requestId: id(98) } : entry),
    [...original, creation("om_requests", id(99))],
    [...original, creation("om_requests", requestId, id(97))],
    [...original, creation("operation_sessions", id(12))],
    original.map((entry, index) => index === 1 ? { ...entry, method: "PATCH" } : entry),
    original.map((entry, index) => index === 1 ? { ...entry, action: "update" } : entry),
    original.map((entry, index) => index === 2 ? { ...entry, targetId: "malformed" } : entry),
    original.map((entry, index) => index === 1 ? { ...entry, targetId: id(13) } : entry)
  ];
  for (const candidate of malformed) { history = candidate; await assert.rejects(preview(), OmAssignmentConflict); }
  assert.deepEqual(writes, []);
});
test("생성 로그의 회차가 삭제/누락된 경우 전체 저장을 차단한다", async () => {
  operations[1].deletedAt = new Date(now);
  await assert.rejects(preview(), /누락되었거나 삭제/);
  operations.splice(1, 1);
  await assert.rejects(preview(), /누락되었거나 삭제/);
});

function repairedLinks(ids: string[]) {
  return [creation("om_requests", requestId, id(200)), ...ids.map(target => creation("operation_sessions", target, id(200)))]
    .map(entry => ({ ...entry, route: "/maintenance/om-request-session-repair", action: "link" }));
}
test("승인 복구의 명시 연결 배치로 2→4회차를 검증하고 원래 생성 이력은 보존한다", async () => {
  row.totalSessions = 4;
  row.sessions.push({ date: "2026-10-03" }, { date: "2026-10-04" });
  operations.push(operation(14), operation(15));
  const original = structuredClone(history);
  history.push(...repairedLinks([id(11), id(12), id(14), id(15)]));
  const result = await preview();
  assert.equal(result.count, 4);
  await assign(result.token);
  assert.equal(operations[2].omName, "다른 요청 담당");
  assert.deepEqual(history.slice(0, original.length), original);
  assert.deepEqual(writes, [id(11), id(12), id(14), id(15), "request"]);
});
test("불완전하거나 중복된 복구 연결은 원래 생성 이력으로 우회하지 않는다", async () => {
  const original = structuredClone(history);
  for (const links of [repairedLinks([id(11)]), repairedLinks([id(11), id(11)]),
    [...repairedLinks([id(11), id(12)]), repairedLinks([])[0]], repairedLinks([id(12), id(13)])]) {
    history = [...original, ...links];
    await assert.rejects(preview(), OmAssignmentConflict);
    assert.deepEqual(writes, []);
  }
});
test("복구 배치에 다른 요청이 섞이면 배정을 차단한다", async () => {
  const links = repairedLinks([id(11), id(12)]);
  history.push(...links, { ...links[0], targetId: id(99) });
  await assert.rejects(preview(), OmAssignmentConflict);
  assert.deepEqual(writes, []);
});
test("단일 회차라도 빈 복구 연결을 대표 회차로 대체하지 않는다", async () => {
  row.totalSessions = 1; row.sessions = row.sessions.slice(0, 1);
  history.push(...repairedLinks([]));
  await assert.rejects(preview(), OmAssignmentConflict);
  assert.deepEqual(writes, []);
});
test("단일 회차 요청은 회차 생성 감사가 누락돼도 저장된 대표 연결로 안전하게 복구한다", async () => {
  row.totalSessions = 1;
  row.sessions = [row.sessions[0]];
  operations = [operations[0]];
  history = [creation("om_requests", requestId)];
  const result = await preview();
  assert.equal(result.count, 1);
  assert.deepEqual(result.operations.map(operation => operation.operationId), [operations[0].operationId]);
});
test("다회차 요청은 회차 생성 감사가 없을 때 형제 회차를 추측하지 않는다", async () => {
  history = [creation("om_requests", requestId)];
  await assert.rejects(preview(), /요청한 회차 수와 확인된 연결 회차 수가 다릅니다/);
});
test("요청 또는 두 번째 회차 저장 실패는 같은 트랜잭션의 변경을 전부 롤백한다", async () => {
  const { token } = await preview();
  const before = structuredClone({ row, operations });
  requestFailure = true;
  await assert.rejects(assign(token), /fixture request failure/);
  assert.deepEqual({ row, operations }, before);
  assert.deepEqual(writes, []);
  requestFailure = false; operationFailure = true;
  await assert.rejects(assign(token), /fixture operation failure/);
  assert.deepEqual({ row, operations }, before);
  assert.deepEqual(writes, []);
});
test("동시 변경 Serializable 실패는 롤백하고409로 반환한다", async () => {
  const { token } = await preview();
  const before = structuredClone({ row, operations });
  commitFailure = Object.assign(new Error("fixture serialization failure"), { code: "P2034" });
  await assert.rejects(assign(token), OmAssignmentConflict);
  assert.deepEqual({ row, operations }, before);
  assert.deepEqual(writes, []);
});
test("로컬 JSON은 연결 유무와 무관하게 preview/write를 안전하게 거부한다", async () => {
  process.env.OPERATION_DATA_SOURCE = "local";
  for (const linked of ["round-11", null]) {
    row.operationId = linked;
    await assert.rejects(preview(), /로컬 파일 모드/);
    await assert.rejects(assign("invalid"), /로컬 파일 모드/);
  }
  assert.deepEqual(writes, []);
});
test("서명 secret 없이는 preview를 발급하지 않으며 기존 NEXTAUTH_SECRET은 사용한다", async () => {
  delete process.env.AUTH_SECRET;
  await assert.rejects(preview(), /AUTH_SECRET/);
  process.env.NEXTAUTH_SECRET = "legacy-fixture-key";
  await assign((await preview()).token);
  assert.equal(row.assignedOm, "새 담당");
});

// 요청 수정(PATCH)은 같은 감사 배치에 요청 update와 회차 create/delete를 남긴다.
function editBatch(batch: string, created: string[], deleted: string[] = [], request = requestId) {
  const occurredAt = at();
  const entry = (targetType: string, targetId: string, action: string): Creation => ({ requestId: batch, route: "/api/om-request/[id]", method: "PATCH", action, targetType, targetId, occurredAt });
  return [entry("om_requests", request, "update"), ...created.map(target => entry("operation_sessions", target, "create")),
    ...deleted.map(target => entry("operation_sessions", target, "delete")), entry("operation_sessions", id(11), "update")];
}
test("요청 수정으로 2→1회차로 줄인 뒤에도 남은 회차만 미리보기·확인 배정한다", async () => {
  row.totalSessions = 1; row.sessions = row.sessions.slice(0, 1);
  operations[1].deletedAt = new Date(now);
  history.push(...editBatch(id(300), [], [id(12)]));
  const result = await preview();
  assert.deepEqual(result.operations.map(op => op.operationId), ["round-11"]);
  await assign(result.token);
  assert.deepEqual(writes, [id(11), "request"]);
  assert.equal(operations[1].omName, "수동 담당 12");
});
test("요청 수정으로 회차를 늘리고 다시 고쳐도(2회 이상) 최종 회차 집합으로 배정한다", async () => {
  row.totalSessions = 3; row.sessions.push({ date: "2026-10-03" });
  operations.push(operation(14), operation(15));
  history.push(...editBatch(id(300), [id(14)]));
  assert.deepEqual((await preview()).operations.map(op => op.operationId), ["round-11", "round-12", "round-14"]);
  // 두 번째 수정: 대표 1회차를 지우고 새 회차를 추가, 세 번째 수정: 방금 추가한 회차를 다시 지움.
  operations[0].deletedAt = new Date(now); row.operationId = "round-12";
  history.push(...editBatch(id(301), [id(15)], [id(11)]));
  assert.deepEqual((await preview()).operations.map(op => op.operationId), ["round-12", "round-14", "round-15"]);
  operations[4].deletedAt = new Date(now);
  row.totalSessions = 2; row.sessions.pop();
  history.push(...editBatch(id(302), [], [id(15)]));
  const result = await preview();
  assert.deepEqual(result.operations.map(op => op.operationId), ["round-12", "round-14"]);
  await assign(result.token);
  assert.deepEqual(writes, [id(12), id(14), "request"]);
});
test("승인 복구 이후의 요청 수정도 복구 집합에 반영한다", async () => {
  operations.push(operation(14));
  history.push(...repairedLinks([id(11), id(12)]));
  row.totalSessions = 3; row.sessions.push({ date: "2026-10-03" });
  history.push(...editBatch(id(300), [id(14)]));
  assert.equal((await preview()).count, 3);
});
test("승인 복구 이전의 요청 수정은 복구 집합에 이미 반영돼 다시 더하거나 빼지 않는다", async () => {
  // 수정으로 14를 추가한 뒤 복구가 11·12·14 전체를 기록했다. 14를 두 번 세면 배정이 막힌다.
  operations.push(operation(14));
  row.totalSessions = 3; row.sessions.push({ date: "2026-10-03" });
  history.push(...editBatch(id(300), [id(14)]), ...repairedLinks([id(11), id(12), id(14)]));
  const result = await preview();
  assert.deepEqual(result.operations.map(op => op.operationId), ["round-11", "round-12", "round-14"]);
  await assign(result.token);
  assert.deepEqual(writes, [id(11), id(12), id(14), "request"]);
});
test("승인 복구 이전에 지운 회차를 되살려 복구했으면 그 삭제 기록으로 다시 빼지 않는다", async () => {
  history.push(...editBatch(id(300), [], [id(12)]), ...repairedLinks([id(11), id(12)]));
  assert.equal((await preview()).count, 2);
});
test("복구 이후 수정은 반영하고, 시각을 알 수 없는 수정·복구 기록은 차단한다", async () => {
  operations.push(operation(14));
  history.push(...editBatch(id(300), [id(14)]), ...repairedLinks([id(11), id(12), id(14)]), ...editBatch(id(301), [], [id(14)]));
  assert.equal((await preview()).count, 2);
  const original = structuredClone(history);
  for (const broken of [
    original.map(entry => entry.requestId === id(301) ? { ...entry, occurredAt: undefined as unknown as Date } : entry),
    original.map(entry => entry.route === "/maintenance/om-request-session-repair" ? { ...entry, occurredAt: new Date(Number.NaN) } : entry)
  ]) {
    history = broken;
    await assert.rejects(preview(), OmAssignmentConflict);
  }
  assert.deepEqual(writes, []);
});
test("요청 수정 기록이 있어도 다른 요청 회차 혼입·삭제 회차·대표 제외·형식 오류는 차단한다", async () => {
  row.totalSessions = 3; row.sessions.push({ date: "2026-10-03" });
  operations.push(operation(14));
  const original = structuredClone(history);
  const cases: Array<[Creation[], () => void]> = [
    // 다른 요청의 수정 배치에서 만든 회차는 연결 근거가 아니다.
    [editBatch(id(300), [id(14)], [], id(99)), () => {}],
    // 같은 수정 배치에 다른 요청이 섞이면 전체를 거절한다.
    [[...editBatch(id(300), [id(14)]), editBatch(id(300), [], [], id(99))[0]], () => {}],
    // 다른 경로·method의 회차 생성은 수정 근거로 쓰지 않는다.
    [editBatch(id(300), [id(14)]).map(entry => entry.targetType === "operation_sessions" ? { ...entry, method: "POST" } : entry), () => {}],
    [editBatch(id(300), [id(14)]).map(entry => ({ ...entry, requestId: "not-a-uuid" })), () => {}],
    // 연결 집합에 삭제된 회차가 남아 있으면 차단한다.
    [editBatch(id(300), [id(14)]), () => { operations[3].deletedAt = new Date(now); }],
    // 대표 회차가 수정으로 빠졌는데 요청이 여전히 가리키면 차단한다.
    [editBatch(id(300), [id(14), id(15)], [id(11)]), () => { operations.push(operation(15)); }]
  ];
  for (const [edit, mutate] of cases) {
    const snapshot = structuredClone(operations);
    history = [...original, ...edit];
    mutate();
    await assert.rejects(preview(), OmAssignmentConflict);
    assert.deepEqual(writes, []);
    operations = snapshot;
  }
});
