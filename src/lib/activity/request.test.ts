import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { activityContext } from "./context";

const rows: Record<string, unknown>[] = [];
const session = mock.fn(async () => ({ user: { email: "USER@day1company.co.kr", name: "테스트 사용자" } }));
const create = mock.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.push(data); });
const tx = { $queryRaw: async () => [], $executeRaw: async () => 0, activityRequest: { create } };
mock.module("@/auth", { namedExports: { auth: session } });
mock.module("@/lib/data/prisma", { namedExports: { getPrismaClient: () => ({ $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) }) } });
const { withActivity } = await import("./request");
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalBypass = process.env.DEV_AUTH_BYPASS;
afterEach(() => {
  rows.length = 0;
  create.mock.mockImplementation(async ({ data }) => { rows.push(data); });
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalBypass === undefined) delete process.env.DEV_AUTH_BYPASS; else process.env.DEV_AUTH_BYPASS = originalBypass;
});
function setup() { process.env.DATABASE_URL = "test-mock"; delete process.env.DEV_AUTH_BYPASS; }

test("records only metadata, uses trusted identity and links request context", async () => {
  setup();
  let seenId: string | undefined;
  const handler = withActivity("/api/example/[id]", "POST", async (_request: Request) => {
    void _request;
    seenId = activityContext.getStore()?.requestId;
    return new Response("private-response", { status: 201 });
  });
  const response = await handler(new Request("http://localhost/api/example/private-id?secret=never-store", { method: "POST", body: "never-store-body" }));
  assert.equal(response.status, 201);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, seenId);
  assert.equal(rows[0].actorEmail, "user@day1company.co.kr");
  assert.equal(rows[0].route, "/api/example/[id]");
  assert.ok(!JSON.stringify(rows).includes("never-store"));
  assert.equal(activityContext.getStore(), undefined);
});
test("token requests are never attributed to an unrelated browser session", async () => {
  setup();
  await withActivity("/api/sync/all", "POST", async (_request: Request) => { void _request; return new Response(null, { status: 403 }); })(new Request("http://localhost", { headers: { authorization: "Bearer never-store" } }));
  assert.equal(rows[0].actorType, "token_request");
  assert.equal(rows[0].actorEmail, null);
  assert.equal(rows[0].status, 403);
});
test("logging failure cannot turn a successful handler into an error", async () => {
  setup();
  create.mock.mockImplementation(async () => { throw new Error("sensitive driver parameters"); });
  const errorLog = mock.method(console, "error", () => {});
  try {
    const response = await withActivity("/api/example", "GET", async () => new Response("ok"))();
    assert.equal(await response.text(), "ok");
    assert.ok(errorLog.mock.calls.every((call) => !JSON.stringify(call.arguments).includes("sensitive")));
  } finally { errorLog.mock.restore(); }
});
test("thrown failures remain failures and redirects retain their status", async () => {
  setup();
  const error = new Error("private failure");
  await assert.rejects(withActivity("/api/example", "PATCH", async () => { throw error; })(), (actual) => actual === error);
  assert.equal(rows[0].status, 500);
  const redirect = { digest: "NEXT_REDIRECT;replace;/sign-in;307;" };
  await assert.rejects(withActivity("/api/example", "PATCH", async () => { throw redirect; })());
  assert.equal(rows[1].status, 307);
});

test("write freeze rejects saves before compose and skips request logs", async () => {
  setup();
  process.env.HUB_WRITE_FREEZE = "true";
  try {
    let composed = 0, handled = 0;
    const compose = async <T,>(work: () => Promise<T>) => { composed += 1; return work(); };
    const save = withActivity("/api/om-request", "POST", async (_request: Request) => { void _request; handled += 1; return new Response(null, { status: 201 }); }, compose);
    const response = await save(new Request("http://localhost/api/om-request", { method: "POST", body: "{}" }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "WRITE_FREEZE");
    assert.equal(composed, 0); assert.equal(handled, 0);
    for (const verb of ["PATCH", "PUT", "DELETE"]) assert.equal((await save(new Request("http://localhost/api/om-request", { method: verb }))).status, 503);
    const coachRead = withActivity("/api/coach/schedule/[yearMonth]", "GET", async (_request: Request) => { void _request; handled += 1; return new Response("ok"); });
    assert.equal((await coachRead(new Request("http://localhost/api/coach/schedule/2026-10"))).status, 503);
    const read = withActivity("/api/operations", "GET", async (_request: Request) => { void _request; handled += 1; return new Response("ok"); }, compose);
    assert.equal((await read(new Request("http://localhost/api/operations"))).status, 200);
    assert.equal(handled, 1); assert.equal(rows.length, 0);
  } finally { delete process.env.HUB_WRITE_FREEZE; }
});
test("write freeze is off unless exactly true", async () => {
  setup();
  for (const value of [undefined, "", "1", "TRUE", "false"]) {
    if (value === undefined) delete process.env.HUB_WRITE_FREEZE; else process.env.HUB_WRITE_FREEZE = value;
    const save = withActivity("/api/om-request", "POST", async (_request: Request) => { void _request; return new Response(null, { status: 201 }); });
    assert.equal((await save(new Request("http://localhost/api/om-request", { method: "POST" }))).status, 201);
  }
  delete process.env.HUB_WRITE_FREEZE;
});
