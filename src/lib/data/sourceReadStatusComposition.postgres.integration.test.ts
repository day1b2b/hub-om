import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { Pool } from "pg";

const url = process.env.SOURCE_READ_STATUS_PG_TEST_URL;
const user = { email: "synthetic.source.pg@day1company.co.kr", name: "Synthetic Source PG" };
mock.module("@/auth", { namedExports: { auth: async () => ({ user, expires: "" }) } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const route = await import("../../app/api/source-reads/status/route"); hooks.deregister();

test("source status composition defaults to actual isolated PostgreSQL audit", { skip: !url, timeout: 120_000 }, async () => {
  const target = new URL(url!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.password, "");
  const names = ["DATABASE_URL", "SOURCE_READ_STATUS_BACKEND", "OPERATION_SOURCE_READER_MODULE", "SALESMAP_API_TOKEN", "GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL", "GOOGLE_CALENDAR_PRIVATE_KEY", "GOOGLE_CALENDAR_IDS", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: url, SOURCE_READ_STATUS_BACKEND: "", OPERATION_SOURCE_READER_MODULE: "", SALESMAP_API_TOKEN: "",
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: "", GOOGLE_CALENDAR_PRIVATE_KEY: "", GOOGLE_CALENDAR_IDS: "",
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const pool = new Pool({ connectionString: url! });
  try {
    await pool.query("TRUNCATE TABLE activity_requests");
    const response = await route.GET(); assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
    const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
    const audit = await pool.query("SELECT route, status FROM activity_requests WHERE id = $1", [requestId]);
    assert.deepEqual(audit.rows, [{ route: "/api/source-reads/status", status: 200 }]);
    process.env.SOURCE_READ_STATUS_BACKEND = "unexpected";
    await assert.rejects(route.GET(), /SOURCE_READ_STATUS_COMPOSITION_FAILED/);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM activity_requests")).rows[0].count, 1);
  } finally {
    await pool.end();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
