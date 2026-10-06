import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { runSalesRevenueSync, runSalesRevenueSyncWithRepositories } from "./salesRevenueSync";
import { getSalesRevenueNotifier, getSalesRevenueSource } from "./salesRevenueSyncRepositoryFactory";
import { safeSalesRevenueIssue } from "./salesRevenueSourceIssues";
import type { SalesRevenueSyncRepository } from "./salesRevenueSyncRepository";
import type { SourceReadResult, SalesRecord } from "../sourceReads/sourceReadTypes";

const actor = "synthetic@example.invalid", poison = "synthetic-private-secret";
function environment(values: Record<string, string | undefined>) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  return () => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}
function repository() {
  let lists = 0, writes = 0, logs = 0;
  const repo: SalesRevenueSyncRepository = {
    async listCourses() { lists++; return [{ id: "synthetic", courseId: "COURSE", name: "Synthetic course", revenue: null, company: { name: "Synthetic company" } }]; },
    async applyUpdates() { writes++; }, async recordLog() { logs++; }
  };
  return { repo, counts: () => [lists, writes, logs] };
}

test("default disabled source and explicit scopes cannot initialize PG or fetch", async () => {
  const restore = environment({ SALESMAP_API_TOKEN: undefined, DATABASE_URL: undefined, PII_ENCRYPTION_KEYS: undefined, PII_ACTIVE_KEY_ID: undefined });
  const fetch = mock.method(globalThis, "fetch", async () => { throw new Error(poison); });
  try {
    assert.equal((await runSalesRevenueSync({ apply: true, actorEmail: actor })).configured, false);
    for (const scope of [{}, { salesRevenueSync: repository().repo }, { salesRevenueSource: { isConfigured: () => true, readSalesRecords: async () => { throw new Error(poison); } } }]) {
      await assert.rejects(runWithDataRepositories(scope, () => runSalesRevenueSync({ apply: true, actorEmail: actor })), { message: "SALES_REVENUE_SYNC_FAILED" });
    }
    assert.equal(fetch.mock.callCount(), 0);
  } finally { fetch.mock.restore(); restore(); }
});

test("real Salesmap reader aggregates synthetic pages, deduplicates deal ids, and blocks partial apply", async () => {
  const restore = environment({ SALESMAP_API_TOKEN: "synthetic-token", SALESMAP_API_BASE_URL: "https://example.invalid", SALESMAP_MAX_PAGES: "2", SALESMAP_PAGE_DELAY_MS: "1", RESOURCE_READ_CACHE_TTL_MS: "0", SALESMAP_FIELD_COURSE_ID: "course", SALESMAP_FIELD_COMPANY: "company", SALESMAP_FIELD_COURSE_NAME: "name" });
  let requests = 0, truncated = false;
  const fetch = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests++; const url = new URL(String(input)); assert.equal(url.origin, "https://example.invalid");
    const second = url.searchParams.has("cursor");
    return Response.json({ data: { dealList: second ? [{ id: "a", course: "COURSE", price: 10 }, { id: "b", course: "COURSE", price: 20 }]
      : [{ id: "a", course: "COURSE", price: 10 }, { id: "missing", course: "EMPTY", price: "" }, { id: "refund", course: "REFUND", price: -1 }, { id: "skip", price: 2 }], nextCursor: !second ? "next" : truncated ? "more" : null } });
  });
  try {
    const reader = getSalesRevenueSource(), data = await reader.readSalesRecords();
    assert.equal(requests, 2); assert.equal(data.status, "ok"); assert.equal(data.items.length, 1);
    assert.equal(data.items[0].revenue, 30); assert.equal(data.items[0].dealCount, 2);
    assert.equal(data.items[0].maxAmount, 20); assert.equal(data.items[0].minAmount, 10); assert.equal(data.items[0].dealsSameAmount, false);
    assert.deepEqual(data.issues.map(safeSalesRevenueIssue), ["금액이 없는 딜 1건을 건너뛰었습니다.", "합산 금액이 0 이하인 코스ID 1건을 제외했습니다(환불 등 확인 필요)."]);
    truncated = true; const f = repository();
    const result = await runSalesRevenueSyncWithRepositories({ apply: true, actorEmail: actor }, f.repo, reader);
    assert.equal(result.readStatus, "partial"); assert.equal(result.applied, false); assert.equal(result.changes[0].after, 30);
    assert.deepEqual(f.counts(), [1, 0, 1]); assert.equal(requests, 4);
    assert.ok(result.issues.includes("딜이 많아 일부만 읽었습니다(최대 2페이지). 전체가 반영되지 않을 수 있습니다."));
  } finally { fetch.mock.restore(); restore(); }
});

test("source network, JSON and arbitrary issue errors never become public exception text", async () => {
  const restore = environment({ SALESMAP_API_TOKEN: "synthetic-token", SALESMAP_API_BASE_URL: "https://example.invalid", RESOURCE_READ_CACHE_TTL_MS: "0" });
  let invalidJson = false;
  const fetch = mock.method(globalThis, "fetch", async () => { if (invalidJson) return new Response(poison, { status: 200 }); throw new Error(poison); });
  try {
    for (invalidJson of [false, true]) {
      const f = repository(), result = await runSalesRevenueSyncWithRepositories({ apply: true, actorEmail: actor }, f.repo, getSalesRevenueSource());
      assert.deepEqual(result.issues, ["세일즈맵 딜을 읽지 못했습니다."]); assert.equal(result.readStatus, "failed"); assert.deepEqual(f.counts(), [0, 0, 0]);
    }
    const cases = [
      { code: "untrusted", message: poison }, { code: "salesmap_deal_missing_amount", message: poison },
      { code: "__proto__", message: poison }, { code: "salesmap_read_failed", message: poison }
    ];
    for (const issue of cases) assert.doesNotMatch(safeSalesRevenueIssue({ ...issue, recoverable: true }), /synthetic-private-secret/);
    const f = repository();
    const source = { isConfigured: () => true, async readSalesRecords(): Promise<SourceReadResult<SalesRecord>> { return { source: "sales", status: "disabled", readAt: "2099-01-01", items: [], issues: [] }; } };
    const result = await runSalesRevenueSyncWithRepositories({ apply: true, actorEmail: actor }, f.repo, source);
    assert.equal(result.configured, true); assert.equal(result.applied, true); assert.deepEqual(f.counts(), [1, 0, 1]);
  } finally { fetch.mock.restore(); restore(); }
});

test("default notifier preserves recipient selection and absorbs lookup/send failures without external sends", async () => {
  let userReads = 0, failing = false; const sent: Array<[string, string]> = [];
  mock.module("./teamUsers/teamUserRepository", { namedExports: { listTeamUsers: async () => { userReads++; if (failing) throw new Error(poison); return [{ email: "synthetic@example.invalid", slackId: "SYNTHETIC" }]; } } });
  mock.module("../slack/notifySlack", { namedExports: { sendSlackDirectMessage: async (id: string, text: string) => { sent.push([id, text]); if (failing) throw new Error(poison); } } });
  const restore = environment({ SALES_SYNC_ALERT_EMAILS: undefined });
  try {
    const notifier = getSalesRevenueNotifier(); await notifier.notifyFailure("synthetic failure"); assert.equal(userReads, 0);
    process.env.SALES_SYNC_ALERT_EMAILS = " SYNTHETIC@example.invalid , missing@example.invalid ";
    await notifier.notifyFailure("synthetic failure"); assert.deepEqual(sent, [["SYNTHETIC", "synthetic failure"]]);
    failing = true; await notifier.notifyFailure("synthetic second"); assert.equal(sent.length, 1);
  } finally { restore(); }
});
