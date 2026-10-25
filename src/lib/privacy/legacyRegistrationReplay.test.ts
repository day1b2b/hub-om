import assert from "node:assert/strict";
import { test } from "node:test";
import { replayLegacyRegistrations } from "./legacyRegistrationReplay";
import type { LegacyStorage, LegacyStorageAccess } from "./legacyDraftSources";

const key = "hub-om:operation-submission:v1:a%40example.test:team_1";
const v1 = (actor = "a@example.test") => JSON.stringify({ version: 1, actor, team: "team_1", id: "fixture-submission-0001", hasResultReport: "Y", payloads: [{ companyName: "가상기업", courseName: "가상과정", roundNo: "1" }] });
function access(value: string | null): LegacyStorageAccess {
  const empty: LegacyStorage = { length: 0, key: () => null, getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const local: LegacyStorage = { length: 1, key: () => key, getItem: k => k === key ? value : null, setItem: () => {}, removeItem: () => {} };
  return kind => kind === "localStorage" ? local : empty;
}
function respond(status: number, body: unknown, calls: RequestInit[] = []): typeof fetch {
  return (async (_url: string, init: RequestInit) => { calls.push(init); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;
}

test("resends the original Idempotency-Key and resolves when the server confirms", async () => {
  const calls: RequestInit[] = [];
  assert.equal(await replayLegacyRegistrations("A@example.test", access(v1()), respond(200, { ok: true, operation: { operationId: "op_1" } }, calls)), "resolved");
  const headers = calls[0].headers as Record<string, string>;
  assert.equal(headers["Idempotency-Key"], "fixture-submission-0001:0");
  assert.equal("X-Operation-Submission-Subject" in headers, false);
});

test("treats an already-processed (409) or never-started (400) request as resolved", async () => {
  assert.equal(await replayLegacyRegistrations("a@example.test", access(v1()), respond(409, { ok: false, error: "이미 처리한 등록 요청" })), "resolved");
  assert.equal(await replayLegacyRegistrations("a@example.test", access(v1()), respond(400, { ok: false, creationNotStarted: true })), "resolved");
});

test("never resends another account's or unreadable request", async () => {
  const calls: RequestInit[] = [];
  assert.equal(await replayLegacyRegistrations("a@example.test", access(v1("b@example.test")), respond(200, {}, calls)), "resolved");
  assert.equal(await replayLegacyRegistrations("a@example.test", access("{broken"), respond(200, {}, calls)), "resolved");
  assert.equal(calls.length, 0);
});

test("keeps the request for a later retry on server or network failure", async () => {
  assert.equal(await replayLegacyRegistrations("a@example.test", access(v1()), respond(500, { ok: false })), "retry");
  const offline = (async () => { throw new TypeError("offline"); }) as typeof fetch;
  assert.equal(await replayLegacyRegistrations("a@example.test", access(v1()), offline), "retry");
});
