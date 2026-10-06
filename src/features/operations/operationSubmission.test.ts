import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptDraft, decryptDraft, type BrowserDraftEnvelope } from "@/lib/privacy/browserDraftCrypto";
import { clearOperationSubmission, hasLegacyOperationSubmission, OperationSubmissionValidationError, persistAndSubmitOperation, persistOperationSubmission, readOperationSubmission, submitOperationSnapshot, type OperationSubmission, type OperationSubmissionStore } from "./operationSubmission";

const owner = "opaque-fixture-owner";
const scope = { owner, kind: "operation-submission", operationId: "team_1" };
function fixture(): OperationSubmission {
  return { version: 2, owner, expectedSubject: "google:fixture", team: "team_1", id: "fixture-submission-0001", hasResultReport: "Y", payloads: [
    { companyName: "가상기업", courseName: "가상과정", roundNo: "1", startDate: "2026-09-21", endDate: "2026-09-23", educationDates: "2026-09-21, 2026-09-23", om: "가상 담당" },
    { roundNo: "2", startDate: "2026-09-24", endDate: "2026-09-24", educationDates: "2026-09-24" }
  ] };
}
async function encryptedStore() {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  let envelope: BrowserDraftEnvelope | undefined;
  let current = true;
  let failWrite = false;
  let failClear = false;
  let beforeCommit: (() => Promise<void>) | undefined;
  const assertCurrent = () => { if (!current) throw new Error("fixture account changed"); };
  const storage: OperationSubmissionStore = {
    owner, expectedSubject: "google:fixture", assertCurrent,
    read: async () => envelope ? decryptDraft(key, scope, envelope) : null,
    write: async (value) => {
      const encrypted = await encryptDraft(key, scope, value);
      await beforeCommit?.();
      assertCurrent();
      if (failWrite) throw new Error("fixture quota");
      envelope = encrypted;
    },
    clear: async () => { assertCurrent(); if (failClear) throw new Error("fixture clear failure"); envelope = undefined; }
  };
  return { storage, raw: () => envelope, switchAccount: () => { current = false; }, quota: () => { failWrite = true; }, failClear: () => { failClear = true; }, delay: (fn: () => Promise<void>) => { beforeCommit = fn; }, corrupt: () => { if (envelope) envelope = { ...envelope, ciphertext: envelope.ciphertext.slice(0,-4) + "AAAA" }; } };
}
function replayServer(lostIndex: number) {
  const commits = new Map<string, { body: string; id: string }>();
  const calls: string[] = [];
  let loseResponse = true;
  const request: typeof fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-Operation-Submission-Subject"), "google:fixture");
    const key = headers.get("Idempotency-Key")!;
    calls.push(key);
    const body = String(init?.body);
    const existing = commits.get(key);
    if (existing) assert.equal(existing.body, body);
    else commits.set(key, { body, id: `fixture-operation-${commits.size}` });
    if (key.endsWith(`:${lostIndex}`) && loseResponse) { loseResponse = false; throw new TypeError("fixture response lost after commit"); }
    return Response.json({ ok: true, operation: { operationId: commits.get(key)!.id } });
  };
  return { commits, calls, request };
}

test("암호문 commit이 끝나기 전에는 네트워크를 시작하지 않는다", async () => {
  const store = await encryptedStore();
  let finish!: () => void;
  let encryptionReady!: () => void;
  const started = new Promise<void>(resolve => { encryptionReady = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  store.delay(async () => { encryptionReady(); await gate; });
  const server = replayServer(-1);
  const saving = persistAndSubmitOperation(store.storage, fixture(), server.request);
  await started;
  assert.equal(server.calls.length, 0);
  assert.equal(store.raw(), undefined);
  finish();
  await saving;
  assert.equal(server.commits.size, 2);
  for (const value of ["가상기업", "가상과정", "가상 담당"]) assert.ok(!JSON.stringify(store.raw()).includes(value));
});

test("첫/후속 commit 응답 유실 뒤 암호문을 복구해 동일 키·본문·회차순서로 재개한다", async () => {
  for (const lost of [0, 1]) {
    const store = await encryptedStore();
    const snapshot = fixture();
    const server = replayServer(lost);
    await assert.rejects(persistAndSubmitOperation(store.storage, snapshot, server.request));
    const restored = await readOperationSubmission(store.storage, snapshot.team);
    assert.deepEqual(restored, snapshot);
    await submitOperationSnapshot(restored!, server.request, store.storage.assertCurrent);
    assert.equal(server.commits.size, 2);
    assert.deepEqual(server.calls, (lost === 0 ? [0,0,1] : [0,1,0,1]).map(i => `${snapshot.id}:${i}`));
  }
});

test("quota와 계정변경은 기존 암호문을 보존하고 첫 POST를 막는다", async () => {
  for (const failure of ["quota", "account"] as const) {
    const store = await encryptedStore();
    await persistOperationSubmission(store.storage, fixture());
    const before = JSON.stringify(store.raw());
    if (failure === "quota") store.quota(); else store.delay(async () => store.switchAccount());
    const server = replayServer(-1);
    await assert.rejects(persistAndSubmitOperation(store.storage, fixture(), server.request));
    assert.equal(server.calls.length, 0);
    assert.equal(JSON.stringify(store.raw()), before);
  }
});

test("복구 owner/team 불일치·손상은 암호문을 삭제하거나 빈 신규등록으로 바꾸지 않는다", async () => {
  const store = await encryptedStore();
  await persistOperationSubmission(store.storage, fixture());
  const before = JSON.stringify(store.raw());
  await assert.rejects(readOperationSubmission({ ...store.storage, owner: "other-owner" }, "team_1"));
  await assert.rejects(readOperationSubmission(store.storage, "team_2"));
  assert.equal(JSON.stringify(store.raw()), before);
  store.corrupt();
  const damaged = JSON.stringify(store.raw());
  await assert.rejects(readOperationSubmission(store.storage, "team_1"));
  assert.equal(JSON.stringify(store.raw()), damaged);
});

test("계정이 응답 대기 중 변경되면 후속 회차 전송을 중단한다", async () => {
  const store = await encryptedStore();
  let calls = 0;
  const request: typeof fetch = async () => { calls++; store.switchAccount(); return Response.json({ ok: true, operation: { operationId: "first" } }); };
  await assert.rejects(persistAndSubmitOperation(store.storage, fixture(), request));
  assert.equal(calls, 1);
  assert.ok(store.raw());
});

test("첫 회차 확정 무저장400만 구분하고 후속400은 snapshot을 보존한다", async () => {
  const store = await encryptedStore();
  await persistOperationSubmission(store.storage, fixture());
  const response = () => Response.json({ ok: false, creationNotStarted: true, error: "fixture validation" }, { status: 400 });
  await assert.rejects(submitOperationSnapshot(fixture(), async () => response()), OperationSubmissionValidationError);
  let calls = 0;
  await assert.rejects(submitOperationSnapshot(fixture(), async () => ++calls === 1 ? Response.json({ ok: true, operation: { operationId: "first" } }) : response()), (error: unknown) => error instanceof Error && !(error instanceof OperationSubmissionValidationError));
  assert.ok(store.raw());
  store.failClear();
  await assert.rejects(clearOperationSubmission(store.storage));
  assert.deepEqual(await readOperationSubmission(store.storage, "team_1"), fixture());
});

test("후속 날짜 오류는 암호문 쓰기와 첫 네트워크 전 차단하고 실제교육일을 우선한다", async () => {
  const store = await encryptedStore();
  const snapshot = fixture();
  snapshot.payloads[1] = { roundNo: "2", startDate: "2026-09-25", endDate: "2026-09-24" };
  const server = replayServer(-1);
  await assert.rejects(persistAndSubmitOperation(store.storage, snapshot, server.request), /2회차/);
  assert.equal(store.raw(), undefined);
  assert.equal(server.calls.length, 0);
  snapshot.payloads[1].educationDates = "2026-09-24";
  await persistOperationSubmission(store.storage, snapshot);
});

test("legacy 평문은 값 읽기·귀속·삭제 없이 존재만 확인한다", () => {
  const storage = { length: 2, key: (index: number) => ["other", "hub-om:operation-submission:v1:legacy-owner:team_1"][index] };
  assert.equal(hasLegacyOperationSubmission(storage), true);
  assert.equal(hasLegacyOperationSubmission({ length: 0, key: () => null }), false);
});
