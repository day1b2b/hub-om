import assert from "node:assert/strict";
import { test } from "node:test";
import { operationSubmissionStore } from "./operationSubmissionStore";
import { persistAndSubmitOperation, type OperationSubmission } from "./operationSubmission";

function fixture() {
  let current = { status: "ready", ownerId: "bdo1_" + "a".repeat(43), generation: 2 };
  let subject = "google:fixture";
  let record: { value: unknown; revision: string } | null = null;
  let counter = 0;
  const calls: unknown[] = [];
  const conflict = () => Object.assign(new Error("fixture changed"), { name: "DraftConflictError" });
  const runtime = {
    getSnapshot: () => current,
    getSubject: () => subject,
    readVersioned: async <T>(kind: string, id: string): Promise<{ value: T | null; revision: string | null }> => { calls.push(["read", kind, id]); return { value: (record?.value ?? null) as T | null, revision: record?.revision ?? null }; },
    writeIfUnchanged: async (kind: string, id: string, value: unknown, expected: string | null) => {
      if ((record?.revision ?? null) !== expected) throw conflict();
      calls.push(["write", kind, id]); record = { value, revision: `encrypted-revision-${++counter}` }; return record.revision;
    },
    removeIfUnchanged: async (kind: string, id: string, expected: string | null) => {
      if ((record?.revision ?? null) !== expected) throw conflict();
      calls.push(["clear", kind, id]); record = null;
    }
  };
  const store = () => operationSubmissionStore(runtime, current, "team_1", "google:fixture");
  const snapshot: OperationSubmission = { version: 2, owner: current.ownerId, expectedSubject: subject, team: "team_1", id: "fixture-submission-0001", hasResultReport: "Y", payloads: [{ companyName: "가상기업", courseName: "가상과정", roundNo: "1", startDate: "2026-09-21", endDate: "2026-09-21" }] };
  return { runtime, store, snapshot, calls, record: () => record, session: () => current, change: (value: Partial<typeof current>) => { current = { ...current, ...value }; }, subject: (value: string) => { subject = value; } };
}

test("owner·generation·subject를 고정하고 팀 scope에는 이메일을 넣지 않는다", async () => {
  const f = fixture(); const store = f.store();
  assert.equal(await store.read(), null);
  assert.deepEqual(f.calls, [["read", "operation-submission", "team_1"]]);
  f.change({ generation: 3 });
  assert.throws(store.assertCurrent, /저장 키가 변경/);
  await assert.rejects(store.read()); await assert.rejects(store.clear());
  f.change({ generation: 2, status: "locked" });
  assert.throws(store.assertCurrent); assert.throws(f.store);
  f.change({ status: "ready", ownerId: "bdo1_" + "b".repeat(43) });
  assert.throws(store.assertCurrent);
  f.change({ ownerId: f.snapshot.owner }); f.subject("google:other");
  assert.throws(store.assertCurrent); assert.throws(f.store);
});

test("읽기 전 쓰기 금지, 두 탭의 신규등록 충돌은 기존 snapshot을 보존하고 POST0", async () => {
  const f = fixture(); const a = f.store(), b = f.store();
  await assert.rejects(a.write(f.snapshot), /먼저 확인/);
  await Promise.all([a.read(), b.read()]);
  await a.write(f.snapshot);
  const first = structuredClone(f.record());
  let requests = 0;
  await assert.rejects(persistAndSubmitOperation(b, { ...f.snapshot, id: "fixture-submission-0002" }, async () => { requests++; return Response.json({}); }), /다른 탭/);
  assert.equal(requests, 0); assert.deepEqual(f.record(), first);
});

test("같은 snapshot을 재개한 두 탭 중 오래된 clear는 새 등록을 삭제하지 않는다", async () => {
  const f = fixture(); const a = f.store(), b = f.store();
  await a.read(); await a.write(f.snapshot); await b.read();
  await a.clear();
  const fresh = f.store(); await fresh.read();
  await fresh.write({ ...f.snapshot, id: "fixture-submission-0003" });
  const newer = structuredClone(f.record());
  await assert.rejects(b.clear(), /다른 탭/);
  assert.deepEqual(f.record(), newer);
  assert.equal((await f.store().read() as OperationSubmission).id, "fixture-submission-0003");
});
