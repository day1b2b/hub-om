import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, beforeEach, mock, test } from "node:test";
let session: { user?: { email?: string }; browserDraftSubject?: string } | null;
let authFailure = false;
const auth = mock.fn(async () => { if (authFailure) throw new Error("sensitive synthetic failure"); return session; });
mock.module("@/auth", { namedExports: { auth } });
const { POST } = await import("./route");
const names = ["BROWSER_DRAFT_MASTER_KEYS", "BROWSER_DRAFT_ACTIVE_KEY_ID", "BROWSER_DRAFT_OWNER_KEY", "PII_ENCRYPTION_KEYS", "DEV_AUTH_BYPASS", "NODE_ENV", "AUTH_URL", "BROWSER_DRAFT_APP_ORIGIN"];
const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
const master = randomBytes(32).toString("base64"), ownerKey = randomBytes(32).toString("base64");
after(() => { for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; } });
beforeEach(() => {
  session = { user: { email: "synthetic@day1company.co.kr" }, browserDraftSubject: "google:synthetic-a" };
  authFailure = false; auth.mock.resetCalls();
  process.env.BROWSER_DRAFT_MASTER_KEYS = JSON.stringify({ fixture: master });
  process.env.BROWSER_DRAFT_ACTIVE_KEY_ID = "fixture";
  process.env.BROWSER_DRAFT_OWNER_KEY = ownerKey;
  process.env.PII_ENCRYPTION_KEYS = "{}";
  process.env.DEV_AUTH_BYPASS = "true";
  Object.assign(process.env, { NODE_ENV: "test" });
  delete process.env.AUTH_URL;
  delete process.env.BROWSER_DRAFT_APP_ORIGIN;
});
function request(headers: Record<string, string> = {}, body?: string, url = "https://fixture.example.test/api/browser-drafts/keyring") {
  return new Request(url, {
    method: "POST", headers: { origin: "https://fixture.example.test", "sec-fetch-site": "same-origin", ...headers }, body,
  });
}
function privateResponse(response: Response) {
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.match(response.headers.get("cache-control") ?? "", /private/);
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}

test("keys belong only to the signed-in subject; body/query identity is never trusted", async () => {
  const first = await POST(request({}, JSON.stringify({ subject: "google:other", ownerId: "other" })));
  assert.equal(first.status, 200); privateResponse(first);
  const actual = await first.json();
  assert.equal(actual.subject, "google:synthetic-a");
  assert.equal(actual.keys.length, 1);
  assert.notEqual(actual.keys[0].keyBase64, master);
  session!.browserDraftSubject = "google:synthetic-b";
  const other = await (await POST(request())).json();
  assert.notEqual(actual.ownerId, other.ownerId);
  assert.notEqual(actual.keys[0].keyBase64, other.keys[0].keyBase64);
});

test("unauthenticated and non-workspace sessions get private 401, never a redirect or dev bypass", async () => {
  for (const unauthorized of [null, {}, { user: {} }, { user: { email: "synthetic@example.test" }, browserDraftSubject: "google:synthetic-a" }]) {
    session = unauthorized;
    const response = await POST(request());
    assert.equal(response.status, 401); privateResponse(response);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
});

test("old sessions without provider subject require reauthentication and never fall back to email", async () => {
  delete session!.browserDraftSubject;
  const response = await POST(request());
  assert.equal(response.status, 409); privateResponse(response);
  assert.deepEqual(await response.json(), { error: "reauthentication_required" });
});

test("foreign, missing, null and deceptive origins are refused before authentication", async () => {
  for (const origin of ["", "null", "https://other.example.test", "https://fixture.example.test/path", "https://fixture.example.test@other.example.test"]) {
    const response = await POST(request({ origin }));
    assert.equal(response.status, 403); privateResponse(response);
  }
  const absent = request(); absent.headers.delete("origin");
  assert.equal((await POST(absent)).status, 403);
  assert.equal((await POST(request({ "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await POST(request({ origin: "https://other.example.test", "x-forwarded-host": "other.example.test" }))).status, 403);
  assert.equal(auth.mock.callCount(), 0);
});

test("configuration and auth failures return a generic private error without material", async () => {
  process.env.BROWSER_DRAFT_OWNER_KEY = "";
  const unavailable = await POST(request());
  assert.equal(unavailable.status, 503); privateResponse(unavailable);
  assert.deepEqual(await unavailable.json(), { error: "draft_keys_unavailable" });
  authFailure = true;
  const brokenAuth = await POST(request());
  assert.equal(brokenAuth.status, 503);
  assert.deepEqual(await brokenAuth.json(), { error: "draft_keys_unavailable" });
});


test("production accepts a configured public HTTPS Origin with an internal standalone request URL", async () => {
  Object.assign(process.env, { NODE_ENV: "production", AUTH_URL: "https://fixture.example.test/api/auth" });
  const response = await POST(request({}, undefined, "http://0.0.0.0:3000/api/browser-drafts/keyring"));
  assert.equal(response.status, 200); privateResponse(response);
  assert.equal((await response.json()).subject, "google:synthetic-a");
});

test("production without canonical origin fails closed before auth, despite plausible forwarded headers", async () => {
  Object.assign(process.env, { NODE_ENV: "production" });
  const response = await POST(request({ "x-forwarded-host": "fixture.example.test", "x-forwarded-proto": "https" }));
  assert.equal(response.status, 503); privateResponse(response);
  assert.deepEqual(await response.json(), { error: "draft_keys_unavailable" });
  assert.equal(auth.mock.callCount(), 0);
});

test("dedicated origin overrides AUTH_URL and forwarded host cannot authorize another site", async () => {
  Object.assign(process.env, { NODE_ENV: "production", AUTH_URL: "https://auth.example.test", BROWSER_DRAFT_APP_ORIGIN: "https://fixture.example.test" });
  assert.equal((await POST(request({}, undefined, "http://0.0.0.0:3000/api/browser-drafts/keyring"))).status, 200);
  for (const origin of ["https://auth.example.test", "https://spoof.example.test", "http://0.0.0.0:3000"]) {
    const response = await POST(request({ origin, "x-forwarded-host": new URL(origin).host, "x-forwarded-proto": "https", forwarded: `host=${new URL(origin).host};proto=https` }, undefined, "http://0.0.0.0:3000/api/browser-drafts/keyring"));
    assert.equal(response.status, 403); privateResponse(response);
  }
});

test("malformed or insecure production origin configuration never falls back to request/forwarded headers", async () => {
  Object.assign(process.env, { NODE_ENV: "production", AUTH_URL: "https://fixture.example.test" });
  for (const configured of ["invalid", "http://fixture.example.test", "https://user:password@fixture.example.test", "https://fixture.example.test/path", "https://fixture.example.test?x=1", "https://fixture.example.test#fragment"]) {
    process.env.BROWSER_DRAFT_APP_ORIGIN = configured;
    const response = await POST(request());
    assert.equal(response.status, 503); privateResponse(response);
  }
  assert.equal(auth.mock.callCount(), 0);
});
