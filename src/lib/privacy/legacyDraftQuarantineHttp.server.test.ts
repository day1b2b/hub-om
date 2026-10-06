import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, beforeEach, mock, test } from "node:test";
let session: { user?: { email?: string }; browserDraftSubject?: string } | null;
mock.module("@/auth", { namedExports: { auth: async () => session } });
const { quarantinePost } = await import("./legacyDraftQuarantineHttp.server");
const names = ["BROWSER_DRAFT_QUARANTINE_KEYS", "BROWSER_DRAFT_QUARANTINE_ACTIVE_KEY_ID", "BROWSER_DRAFT_APP_ORIGIN", "NODE_ENV"];
const original = Object.fromEntries(names.map(n => [n, process.env[n]]));
after(() => { for (const n of names) { if (original[n] === undefined) delete process.env[n]; else process.env[n] = original[n]; } });
beforeEach(() => {
  session = { user: { email: "synthetic@day1company.co.kr" }, browserDraftSubject: "google:a" };
  Object.assign(process.env, { NODE_ENV: "production", BROWSER_DRAFT_APP_ORIGIN: "https://fixture.example.test", BROWSER_DRAFT_QUARANTINE_KEYS: JSON.stringify({ q1: randomBytes(32).toString("base64") }), BROWSER_DRAFT_QUARANTINE_ACTIVE_KEY_ID: "q1" });
});
const snapshot = { version: 1, source: "sessionStorage", storageKey: "hub-om:operation-submission:v1:synthetic@email:team", rawValue: "malformed-secret", nonce: randomUUID() };
function request(body: unknown, headers: Record<string, string> = {}) { return new Request("http://0.0.0.0:3000/api/browser-drafts/quarantine/seal", { method: "POST", headers: { origin: "https://fixture.example.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
async function checked(req: Request, action: "seal" | "verify", status: number) {
  const response = await quarantinePost(req, action); assert.equal(response.status, status); assert.match(response.headers.get("cache-control")!, /no-store/); const body = await response.json(); assert.equal(JSON.stringify(body).includes(snapshot.rawValue), false); assert.equal(JSON.stringify(body).includes(snapshot.storageKey), false); return body;
}
test("seal and persisted ciphertext verify return only opaque record or matching acknowledgement", async () => {
  const { record } = await checked(request({ snapshot }), "seal", 200);
  assert.deepEqual(await checked(request({ record: JSON.parse(JSON.stringify(record)), snapshot }), "verify", 200), { verified: true, id: record.envelope.id, nonce: snapshot.nonce });
  await checked(request({ record, snapshot: { ...snapshot, rawValue: "changed" } }), "verify", 409);
  session!.browserDraftSubject = "google:b"; await checked(request({ record, snapshot }), "verify", 409);
});
test("auth, subject, origin, configuration, schema failures are private and fail closed", async () => {
  await checked(request({ snapshot }, { origin: "https://evil.test" }), "seal", 403);
  await checked(request({ snapshot }, { "sec-fetch-site": "cross-site" }), "seal", 403);
  session = null; await checked(request({ snapshot }), "seal", 401);
  session = { user: { email: "synthetic@day1company.co.kr" } }; await checked(request({ snapshot }), "seal", 409);
  session.browserDraftSubject = "google:a";
  await checked(request({ snapshot, owner: "fake" }), "seal", 400);
  delete process.env.BROWSER_DRAFT_QUARANTINE_KEYS; await checked(request({ snapshot }), "seal", 503);
});
test("bounds actual streamed bytes even without content-length", async () => {
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < 25; i++) controller.enqueue(new Uint8Array(1024 * 1024)); controller.close(); } });
  const req = new Request("https://fixture.example.test/api", { method: "POST", headers: { origin: "https://fixture.example.test", "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  await checked(req, "seal", 413);
  await checked(request({ snapshot }, { "content-length": String(25 * 1024 * 1024) }), "seal", 413);
});
