import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { assertCreationReplay, creationOperationId, creationOperationPrefix, operationCreationIdentity } from "@/lib/data/operationCreationIdentity";
import type { CreateOperationInput, OperationSession } from "@/lib/data/operationTypes";

let actor = "a@example.test";
let subject: string | undefined = "google:fixture-a";
const deletedIds = new Set<string>();
let denied = false;
let queries = 0;
let creates = 0;
let concurrentRow: OperationSession | null = null;
const rows = new Map<string, OperationSession>();
const base = { operationId: "base", roundNo: "1", courseId: "fixture-course", companyName: "Fixture", courseName: "Fixture", om: "", ld: "" } as OperationSession;
const repository = {
  getOperationById: async (id: string) => { queries++; return id === "base" ? base : deletedIds.has(id) ? null : rows.get(id) ?? null; },
  listOperations: async () => { queries++; if (concurrentRow) rows.set(concurrentRow.operationId, concurrentRow); return [base, ...[...rows.values()].filter(row => !deletedIds.has(row.operationId))]; },
  createOperation: async (input: CreateOperationInput) => {
    queries++;
    if (input.creationIdentity) {
      const prefix = creationOperationPrefix(input.creationIdentity);
      const existing = [...rows.values()].find((row) => row.operationId.startsWith(prefix));
      if (existing) { assertCreationReplay(input.creationIdentity, { ...existing, deletedAt: deletedIds.has(existing.operationId) }); return { ...existing, creationReplayed: true }; }
    }
    creates++;
    const operationId = input.creationIdentity ? creationOperationId(input.creationIdentity) : `fixture-${creates}`;
    const row = { ...input, operationId } as OperationSession;
    rows.set(operationId, row);
    return row;
  }
};
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_r: string, _m: string, fn: unknown) => fn } });
mock.module("@/lib/auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => { if (denied) throw new Error("denied"); return { user: { email: actor }, browserDraftSubject: subject }; } } });
mock.module("@/lib/data/operationRepositoryFactory", { namedExports: { getOperationRepository: () => repository } });
mock.module("@/lib/data/omRequest/omRequestOperationLink", { namedExports: { EDUCATION_FORMAT_BY_TRAINING_TYPE: { "오프라인": "오프라인" } } });
const { POST: create } = await import("./route");
const { POST: round } = await import("./[operationId]/rounds/route");
const body = { companyName: "Fixture", courseName: "Fixture", courseId: "fixture-course", roundNo: "1", startDate: "2026-09-21", endDate: "2026-09-21" };
const key = "fixture-creation-key:0";
const request = (value: unknown, idempotencyKey: string | undefined = key, expectedSubject?: string) => new Request("http://fixture.test/api/operations", {
  method: "POST", headers: { "content-type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), ...(expectedSubject !== undefined ? { "X-Operation-Submission-Subject": expectedSubject } : {}) }, body: JSON.stringify(value)
});
beforeEach(() => { actor = "a@example.test"; subject = "google:fixture-a"; deletedIds.clear(); denied = false; queries = 0; creates = 0; concurrentRow = null; rows.clear(); });

test("첫 회차 응답 유실 후 동일 요청은 기존 ID, 내용 변경은409, 다른 사용자는 다른 ID", async () => {
  const first = await (await create(request(body))).json();
  const replay = await (await create(request(body))).json();
  assert.equal(replay.operation.operationId, first.operation.operationId);
  assert.equal(creates, 1);
  assert.equal((await create(request({ ...body, courseName: "changed" }))).status, 409);
  assert.equal(creates, 1);
  actor = "b@example.test";
  const other = await (await create(request(body))).json();
  assert.notEqual(other.operation.operationId, first.operation.operationId);
  assert.equal(creates, 2);
});
test("인증 완료 전 어떤 repository 조회/쓰기나 기존 응답 반환도 하지 않는다", async () => {
  denied = true;
  await assert.rejects(create(request(body)), /denied/);
  await assert.rejects(round(request(body), { params: Promise.resolve({ operationId: "base" }) }), /denied/);
  assert.equal(queries, 0);
});
test("같은 회차 재시도는 회차 중복 검사보다 먼저 성공으로 복원한다", async () => {
  const payload = { roundNo: "2", startDate: "2026-09-22", endDate: "2026-09-22" };
  const context = { params: Promise.resolve({ operationId: "base" }) };
  const first = await (await round(request(payload), context)).json();
  const replay = await (await round(request(payload), context)).json();
  assert.equal(replay.operation.operationId, first.operation.operationId);
  assert.equal(creates, 1);
  assert.equal((await round(request({ ...payload, startDate: "2026-09-23" }), context)).status, 409);
});
test("초기 replay miss 직후 경쟁 요청이 성공해도 중복409 대신 그 결과를 반환한다", async () => {
  const payload = { roundNo: "2", startDate: "2026-09-22", endDate: "2026-09-22" };
  const identity = operationCreationIdentity(key, actor, "/api/operations/base/rounds", payload)!;
  concurrentRow = { ...base, roundNo: "2", operationId: creationOperationId(identity) };
  const response = await round(request(payload), { params: Promise.resolve({ operationId: "base" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).operation.operationId, concurrentRow.operationId);
  assert.equal(creates, 0);
});
test("잘못된 요청 키는 생성을 시작하지 않는다", async () => {
  assert.equal((await create(request(body, "invalid"))).status, 400);
  assert.equal(creates, 0);
});

test("날짜 역전은 쓰기 시작 전이라는 명시적 응답으로 입력 수정을 허용한다", async () => {
  const response = await create(request({ ...body, endDate: "2026-09-20" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).creationNotStarted, true);
  assert.equal(creates, 0);
});
test("실제 교육일이 있으면 시작/종료일은 실제 교육일에서 파생되므로 유효하게 등록한다", async () => {
  const response = await create(request({ ...body, endDate: "2026-09-20", educationDates: "2026-09-21, 2026-09-23" }));
  assert.equal(response.status, 200);
  assert.equal(creates, 1);
});


test("재개 계정과 현재 세션이 다르거나 실제 subject가 없으면 생성/재생 조회 전409이다", async () => {
  const payload = { roundNo: "2", startDate: "2026-09-22", endDate: "2026-09-22" };
  for (const actual of ["google:fixture-b", undefined, ""]) {
    subject = actual;
    for (const response of [await create(request(body, key, "google:fixture-a")), await round(request(payload, key, "google:fixture-a"), { params: Promise.resolve({ operationId: "base" }) })]) {
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error, "로그인 계정이 변경되었습니다. 원래 계정으로 로그인한 뒤 등록을 재개해주세요.");
    }
    assert.equal(queries, 0); assert.equal(creates, 0);
  }
});
test("subject 헤더는 정확히 일치해야 하며 기존 헤더 없는 호출은 세션subject가 없어도 호환된다", async () => {
  assert.equal((await create(request(body, key, "google:fixture-a"))).status, 200);
  const before = queries;
  assert.equal((await create(request(body, key, "google:Fixture-a"))).status, 409);
  assert.equal(queries, before);
  subject = undefined;
  assert.equal((await create(request(body))).status, 200);
  assert.equal(creates, 1);
  assert.equal((await round(request({ roundNo: "2", startDate: "2026-09-22", endDate: "2026-09-22" }), { params: Promise.resolve({ operationId: "base" }) })).status, 200);
});
test("soft-delete된 회차의 재시도는 조기 성공이나 신규 생성 대신409이다", async () => {
  const payload = { roundNo: "2", startDate: "2026-09-22", endDate: "2026-09-22" };
  const context = { params: Promise.resolve({ operationId: "base" }) };
  const first = await (await round(request(payload), context)).json();
  deletedIds.add(first.operation.operationId);
  const response = await round(request(payload), context);
  assert.equal(response.status, 409);
  assert.equal(creates, 1);
  assert.ok(deletedIds.has(first.operation.operationId));
});
test("같은키의 본문을 다음 회차로 바꿔도 조기 replay나 중복 검사를 우회해 생성하지 않는다", async () => {
  const context = { params: Promise.resolve({ operationId: "base" }) };
  assert.equal((await round(request({ roundNo: "2", startDate: "2026-09-22", endDate: "2026-09-22" }), context)).status, 200);
  const response = await round(request({ roundNo: "3", startDate: "2026-09-23", endDate: "2026-09-23" }), context);
  assert.equal(response.status, 409);
  assert.equal(creates, 1);
});
