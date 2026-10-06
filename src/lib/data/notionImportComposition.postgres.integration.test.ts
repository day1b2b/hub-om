import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { Pool } from "pg";

const url = process.env.NOTION_IMPORT_PG_TEST_URL;
const user = { email: "synthetic.notion.pg@day1company.co.kr", name: "Synthetic Notion PG" };
mock.module("@/auth", { namedExports: { auth: async () => ({ user, expires: "" }) } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(["next/server", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, context);
} });
const route = await import("../../app/api/admin/imports/notion/import/route"); hooks.deregister();

test("Notion import composition defaults to actual isolated PostgreSQL", { skip: !url, timeout: 120_000 }, async () => {
  const target = new URL(url!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.password, "");
  const names = ["DATABASE_URL", "NOTION_IMPORT_BACKEND", "NOTION_TOKEN", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: url!, NOTION_IMPORT_BACKEND: "", NOTION_TOKEN: "synthetic-token",
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const pool = new Pool({ connectionString: url! });
  const fetchMock = mock.method(globalThis, "fetch", async () => Response.json({ results: [{
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", url: "https://example.invalid/notion", properties: {
      "기업명": { type: "rich_text", rich_text: [{ plain_text: "Synthetic PG Company" }] },
      "과정명": { type: "rich_text", rich_text: [{ plain_text: "Synthetic PG Course" }] },
      Date: { type: "date", date: { start: "2031-02-03", end: null } }
    }
  }], has_more: false }));
  try {
    const response = await route.POST(new Request("https://example.invalid/api/admin/imports/notion/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ databaseUrl: "22222222-2222-4222-8222-222222222222", sourceName: "Synthetic PG import" }) }));
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.ok, true); assert.equal(body.storedCount, 1);
    const run = await pool.query("SELECT source_name, imported_by FROM data_import_runs WHERE id = $1", [body.importRunId]);
    assert.equal(run.rowCount, 1); assert.match(run.rows[0].source_name, /^pii:v1:fixture:/); assert.match(run.rows[0].imported_by, /^pii:v1:fixture:/);
    const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM activity_requests WHERE id = $1", [requestId])).rows[0].count, 1);
  } finally {
    await pool.end(); fetchMock.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
