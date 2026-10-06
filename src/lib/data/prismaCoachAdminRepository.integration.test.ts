import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { mock, test } from "node:test";
import pg from "pg";
import { coachAdminPurgeExpected, coachAdminPurgeRows, PURGE_IDS, PURGE_PRIVATE_NAME } from "./coachAdminPurgeFixture";
import { activityContext } from "../activity/context";

mock.module("../auth/requireWorkspaceSession", { namedExports: { requireWorkspaceSession: async () => ({ user: { email: "synthetic-manager@example.invalid", name: "Synthetic manager" } }) } });
mock.module("../auth/requireAdminSession", { namedExports: { assertAdminSession: async () => ({ user: { email: "synthetic-admin@example.invalid", name: "Synthetic admin" } }) } });
mock.module("../activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
const hook = registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const fieldsRoute = await import("../../app/api/master/fields/route"), curriculumsRoute = await import("../../app/api/master/curriculums/route"), deletedRoute = await import("../../app/api/admin/deleted-coaches/route");
hook.deregister();
// Disposable local database only: the test recreates its public schema from the checked-in migrations.
const url = process.env.COACH_ADMIN_PG_TEST_DATABASE_URL;
const json = (method: string, body?: unknown) => new Request("https://example.invalid/api/test", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Baseline for the Mongo adapter: measures the existing PostgreSQL behavior through the same handlers and fixture. */
test("existing PostgreSQL tag-master and deleted-coach behavior through the real handlers", { skip: !url, timeout: 180_000 }, async () => {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/coach_admin_test") throw new Error("Use the isolated coach_admin_test database on 127.0.0.1.");
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL"], saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", DATABASE_URL: url });
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const { getPrismaClient } = await import("./prisma");
  const db = getPrismaClient() as unknown as Record<string, { createMany(args: { data: unknown[] }): Promise<unknown>; count(): Promise<number> }> & { $disconnect(): Promise<void> };
  try {
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations");
    for (const name of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) await sql.query(readFileSync(path.join(root, name, "migration.sql"), "utf8"));
    for (const [model, rows] of coachAdminPurgeRows) await db[model[0].toLowerCase() + model.slice(1)].createMany({ data: rows });
    const counts = async () => Object.fromEntries(await Promise.all(Object.keys(coachAdminPurgeExpected).map(async model => [model, await db[model[0].toLowerCase() + model.slice(1)].count()])));
    const requestId = randomUUID(), before = await counts();
    await activityContext.run({ requestId, route: "/api/admin/deleted-coaches", method: "DELETE", actorType: "user", actorEmail: "synthetic-admin@example.invalid", actorName: "Synthetic admin" }, async () => {
      assert.equal((await deletedRoute.DELETE(json("DELETE", { id: PURGE_IDS.live }))).status, 400);
      assert.equal((await deletedRoute.DELETE(json("DELETE", { id: randomUUID() }))).status, 400);
      assert.deepEqual(await counts(), before);
      const listed = await (await deletedRoute.GET()).json();
      assert.deepEqual(listed.coaches.map((row: { id: string }) => row.id), [PURGE_IDS.restorable, PURGE_IDS.deleted]);
      assert.deepEqual(Object.keys(listed.coaches[0]).sort(), ["deletedAt", "deletedBy", "id", "name", "status", "workType"]);
      assert.equal(listed.coaches[1].name, PURGE_PRIVATE_NAME); assert.equal(listed.coaches[1].deletedBy, "purge-admin@example.invalid");
      const response = await deletedRoute.DELETE(json("DELETE", { id: PURGE_IDS.deleted.toUpperCase() }));
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
      await assert.rejects(deletedRoute.PUT(json("PUT", { id: randomUUID() })));
      assert.deepEqual(await (await deletedRoute.PUT(json("PUT", { id: PURGE_IDS.restorable.toUpperCase() }))).json(), { ok: true, coach: { id: PURGE_IDS.restorable, name: "가상복원코치" } });
      assert.deepEqual((await (await fieldsRoute.GET()).json()).fields.map((row: { name: string }) => row.name), ["가 분야", "나 분야"]);
      assert.deepEqual(Object.keys((await (await fieldsRoute.GET()).json()).fields[0]).sort(), ["id", "name"]);
      assert.deepEqual((await (await fieldsRoute.POST(json("POST", { name: " 나 분야 " }))).json()).field, { id: PURGE_IDS.field, name: "나 분야" });
      const concurrent = await Promise.allSettled([1, 2, 3].map(() => curriculumsRoute.POST(json("POST", { name: "다 커리큘럼" }))));
      const fulfilled = concurrent.filter((row): row is PromiseFulfilledResult<Response> => row.status === "fulfilled");
      assert.ok(fulfilled.length >= 1);
      assert.equal(new Set(await Promise.all(fulfilled.map(async row => (await row.value.json()).curriculum.id))).size, 1);
      console.log(`[baseline] concurrent first-insert curriculum POST: ${fulfilled.length}/3 fulfilled`);
    });
    const expected = { ...coachAdminPurgeExpected, CoachCurriculumMaster: 2 };
    assert.deepEqual(await counts(), expected);
    assert.equal((await sql.query("SELECT confirmed_engagement_id FROM coach_day_reservations WHERE id = $1", [PURGE_IDS.crossReservation])).rows[0].confirmed_engagement_id, null);
    const audit = (await sql.query("SELECT target_type, target_id, action FROM activity_changes WHERE request_id = $1", [requestId])).rows as Array<{ target_type: string; target_id: string; action: string }>;
    for (const table of ["coaches", "coach_private_profiles", "coach_fields", "coach_curriculums", "coach_content_entries", "coach_schedules", "coach_day_reservations", "coach_engagements", "coach_engagement_schedules"])
      assert.ok(audit.some(row => row.target_type === table && row.action === "delete"), `${table} delete audit`);
    assert.ok(audit.some(row => row.target_type === "coach_day_reservations" && row.target_id === PURGE_IDS.crossReservation && row.action === "update"));
    assert.ok(!audit.some(row => ["coach_schedule_access_logs", "coach_private_access_logs"].includes(row.target_type)));
    assert.ok(audit.some(row => row.target_type === "coaches" && row.target_id === PURGE_IDS.restorable && row.action === "restore"));
    assert.ok(!JSON.stringify((await sql.query("SELECT * FROM activity_changes")).rows).includes(PURGE_PRIVATE_NAME));
  } finally {
    try { await db.$disconnect(); await sql.end(); }
    finally { for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
  }
});
