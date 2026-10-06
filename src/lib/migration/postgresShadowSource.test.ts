import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { mongoModelContracts } from "./mongoDocumentCodec";
import { privacyFields } from "../privacy/fields";
import { createPostgresShadowSnapshot, SOURCE_COLUMNS_SQL, SOURCE_PRIMARY_KEYS_SQL, withPostgresShadowSnapshot, type ShadowPgClient } from "./postgresShadowSource";

const schemaText = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const enumLabels = Object.fromEntries([...schemaText.matchAll(/^enum (\w+) \{\n([\s\S]*?)^\}/gm)].map(([, name, body]) => [name, [...body.matchAll(/^\s+(\w+)([^\n]*)$/gm)].map(([, value, attrs]) => /@map\("([^"]+)"\)/.exec(attrs)?.[1] ?? value)]));
function fixture() {
  const columns: Record<string, unknown>[] = [], pks: Record<string, unknown>[] = [];
  for (const [name, model] of Object.entries(mongoModelContracts)) {
    const dmmf = Prisma.dmmf.datamodel.models.find(m => m.name === name)!;
    const columnName = (name: string) => { const f = dmmf.fields.find(f => f.name === name)!; return f.dbName ?? f.name; };
    for (const [field, c] of Object.entries(model.fields)) columns.push({ table_name: model.collection, column_name: columnName(field),
      udt_name: name === "CoachEngagement" && field === "rating" ? "int2" : c.list ? c.dateOnly ? "_date" : "_text" : c.uuid ? "uuid" : ({ String: "text", Int: "int4", Boolean: "bool", Decimal: "numeric", Bytes: "bytea", Json: "jsonb", DateTime: c.dateOnly ? "date" : "timestamp" } as Record<string, string>)[c.type],
      data_type: c.values ? "USER-DEFINED" : "scalar", is_nullable: c.nullable ? "YES" : "NO", enum_values: enumLabels[c.type] ?? [], numeric_precision: c.type === "Decimal" ? 14 : null, numeric_scale: c.type === "Decimal" ? 2 : null, datetime_precision: 3 });
    pks.push({ table_name: model.collection, columns: model.primaryKey.map(columnName) });
  }
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  let releases = 0, failed = false;
  const pages: Record<string, unknown>[][] = [];
  const client: ShadowPgClient = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (failed && sql.startsWith("SELECT ") && ![SOURCE_COLUMNS_SQL, SOURCE_PRIMARY_KEYS_SQL].includes(sql) && !sql.includes("pg_export_snapshot")) throw new Error("secret postgres address");
      if (sql === SOURCE_COLUMNS_SQL) return { rows: columns };
      if (sql === SOURCE_PRIMARY_KEYS_SQL) return { rows: pks };
      if (sql.includes("pg_export_snapshot")) return { rows: [{ snapshot_id: "synthetic-snapshot" }] };
      if (sql.startsWith("SELECT last_value")) return { rows: [{ last_value: "9007199254740993", is_called: false }] };
      if (sql.includes("pg_catalog.pg_sequences")) return { rows: [{ schemaname: "public", sequencename: "courses_process_seq_seq", last_value: "9007199254740993" }] };
      if (sql.startsWith("SELECT ")) return { rows: pages.shift() ?? [] };
      return { rows: [] };
    }, release() { releases++; },
  };
  return { pool: { connect: async () => client }, columns, pks, calls, pages, releases: () => releases, fail: () => { failed = true; } };
}
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("all 35 models validated before rows; one read-only snapshot commits then releases", async () => {
  const f = fixture();
  await withPostgresShadowSnapshot(f.pool, async source => { assert.equal(source.modelNames.length, 35); assert.equal(source.snapshotId, "synthetic-snapshot"); for await (const row of source.rows("Company")) assert.fail(String(row)); });
  assert.equal(f.calls[0].sql, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(f.calls.at(-1)!.sql, "COMMIT"); assert.equal(f.releases(), 1);
  assert.ok(f.calls.every(c => !/^(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)/.test(c.sql)));
});
test("pre-PII missing companions allowed, missing ordinary scalar/schema/PK drift rejected", async () => {
  const f = fixture();
  for (const [model, policy] of Object.entries(privacyFields)) for (const field of Object.values(policy.fields)) for (const col of [field.indexColumn, field.storageColumn]) {
    const index = f.columns.findIndex(c => c.table_name === mongoModelContracts[model].collection && c.column_name === col);
    if (index >= 0) f.columns.splice(index, 1);
  }
  await withPostgresShadowSnapshot(f.pool, async () => {});
  for (const change of [(f: ReturnType<typeof fixture>) => f.columns.splice(f.columns.findIndex(c => c.table_name === "companies" && c.column_name === "name"), 1),
    (f: ReturnType<typeof fixture>) => { f.columns[0].udt_name = "text"; },
    (f: ReturnType<typeof fixture>) => { f.pks[0].columns = ["wrong"]; }]) {
    const broken = fixture(); change(broken);
    await assert.rejects(withPostgresShadowSnapshot(broken.pool, async () => assert.fail("no rows on schema drift")));
    assert.equal(broken.calls.at(-1)!.sql, "ROLLBACK"); assert.equal(broken.releases(), 1);
  }
});
test("single and composite keyset pages preserve exact alias/decimal/date/JSON null semantics", async () => {
  const f = fixture();
  const row: Record<string, unknown> = Object.fromEntries(Object.keys(mongoModelContracts.OperationSession.fields).map(k => [k, null]));
  Object.assign(row, { operationStatus: "active", archiveStatus: "not_ready", id: uuid(1), validationErrors: null, __sql_null_validationErrors: false, educationDates: '["2026-09-22","2026-09-23"]', startDate: "2026-09-22", endDate: "2026-09-23", totalCost: "999999999999.99", createdAt: "2026-09-22 12:30:45.123", updatedAt: "2026-09-22 12:30:45.123+00" });
  for (const [name, field] of Object.entries(mongoModelContracts.OperationSession.fields)) if (field.type === "Json" && name !== "validationErrors") row["__sql_null_" + name] = true;
  f.pages.push([row]);
  await withPostgresShadowSnapshot(f.pool, async source => {
    const result = []; for await (const row of source.rows("OperationSession")) result.push(row);
    assert.equal(result[0].validationErrors, Prisma.JsonNull);
    assert.equal(result[0].operationStatus, "ACTIVE"); assert.equal(result[0].archiveStatus, "NOT_READY");
    assert.equal(result[0].totalCost, "999999999999.99");
    assert.deepEqual(result[0].educationDates, ["2026-09-22T00:00:00.000Z", "2026-09-23T00:00:00.000Z"]);
    assert.equal(result[0].createdAt, "2026-09-22T12:30:45.123Z");
    assert.equal(result[0].updatedAt, "2026-09-22T12:30:45.123Z");
  });
  assert.ok(f.calls.some(c => c.sql.includes('"total_cost"::text AS "totalCost"')));
  const composite = fixture(); composite.pages.push([{ coachId: uuid(1), tagId: uuid(2) }], [{ coachId: uuid(1), tagId: uuid(3) }], []);
  await withPostgresShadowSnapshot(composite.pool, async source => { let count = 0; for await (const row of source.rows("CoachField")) { assert.ok(row.coachId); count++; } assert.equal(count, 2); }, { batchSize: 1 });
  const query = composite.calls.find(c => c.sql.includes(" WHERE ("));
  assert.match(query!.sql, /\("coach_id", "tag_id"\) > \(\$1::uuid, \$2::uuid\)/);
  assert.deepEqual(query!.values, [uuid(1), uuid(2), 1]);
});
test("export lifecycle keeps transaction open across pages, rejects wrong cursor, exact sequence and commit/abort", async () => {
  const f = fixture(); f.pages.push([{ id: uuid(1), name: "synthetic", normalizedName: "synthetic", createdAt: "2026-09-22 00:00:00", updatedAt: "2026-09-22 00:00:00" }]);
  const snapshot = await createPostgresShadowSnapshot(f.pool);
  assert.equal(snapshot.readOnly, true); assert.equal(f.releases(), 0);
  const rows = await snapshot.page("Company", null, 10); assert.equal(rows.length, 1);
  await assert.rejects(snapshot.page("Company", null, 10), /SOURCE_CURSOR_INVALID/);
  assert.equal((await snapshot.sequenceHighWater())["public.courses_process_seq_seq"], "9007199254740993");
  await snapshot.finish(); assert.equal(f.calls.at(-1)!.sql, "COMMIT"); assert.equal(f.releases(), 1);
  await assert.rejects(snapshot.page("Company", uuid(1), 10));
  const aborted = fixture(); const other = await createPostgresShadowSnapshot(aborted.pool); await other.abort(); assert.equal(aborted.calls.at(-1)!.sql, "ROLLBACK"); assert.equal(aborted.releases(), 1);
});
test("read failures roll back without exposing raw database error", async () => {
  const f = fixture(); f.fail();
  await assert.rejects(withPostgresShadowSnapshot(f.pool, async source => { for await (const row of source.rows("Company")) { assert.ok(row.id); } }), { message: "PostgreSQL shadow source failed: READ_FAILED" });
  assert.equal(f.calls.at(-1)!.sql, "ROLLBACK");
});

test("factory initialization and COMMIT failures roll back/release, with generic errors", async () => {
  const bad = fixture(); bad.columns.splice(0, 1);
  await assert.rejects(createPostgresShadowSnapshot(bad.pool));
  assert.equal(bad.releases(), 1); assert.equal(bad.calls.at(-1)!.sql, "ROLLBACK");
  const failed = fixture(); const client = await failed.pool.connect(); const query = client.query.bind(client);
  client.query = async (sql, values) => { if (sql === "COMMIT") throw new Error("sensitive connection"); return query(sql, values); };
  const snapshot = await createPostgresShadowSnapshot(failed.pool);
  await assert.rejects(snapshot.finish(), { message: "PostgreSQL shadow source failed: FINISH_FAILED" });
  assert.equal(failed.calls.at(-1)!.sql, "ROLLBACK"); assert.equal(failed.releases(), 1);
  await snapshot.abort(); assert.equal(failed.releases(), 1);
  await assert.rejects(createPostgresShadowSnapshot({ connect: async () => { throw new Error("sensitive connection"); } }), { message: "PostgreSQL shadow source failed: CONNECT_FAILED" });
});

test("catalog arrays are explicitly text[] and enum labels accept actual creation order", async () => {
  assert.match(SOURCE_COLUMNS_SQL, /e\.enumlabel::text/);
  assert.match(SOURCE_PRIMARY_KEYS_SQL, /array_agg\(k\.column_name::text/);
  const f = fixture(); for (const column of f.columns) if (Array.isArray(column.enum_values)) column.enum_values.reverse();
  await withPostgresShadowSnapshot(f.pool, async () => {});
  const invalid = fixture(); invalid.columns.find(c => c.data_type === "USER-DEFINED")!.enum_values = ["unmapped"];
  await assert.rejects(withPostgresShadowSnapshot(invalid.pool, async () => {}), /SOURCE_ENUM_DRIFT/);
});

test("factory page errors are generic and caller abort releases its snapshot", async () => {
  const f = fixture(); const source = await createPostgresShadowSnapshot(f.pool); f.fail();
  await assert.rejects(source.page("Company", null, 10), { message: "PostgreSQL shadow source failed: READ_FAILED" });
  await source.abort(); assert.equal(f.releases(), 1); assert.equal(f.calls.at(-1)!.sql, "ROLLBACK");
});

test("declared SmallInt columns retain native width instead of accepting an int4 drift", async () => {
  const f = fixture();
  const rating = f.columns.find(column => column.table_name === "coach_engagements" && column.column_name === "rating")!;
  assert.equal(rating.udt_name, "int2"); await withPostgresShadowSnapshot(f.pool, async () => {});
  rating.udt_name = "int4";
  await assert.rejects(withPostgresShadowSnapshot(f.pool, async () => {}), /SOURCE_TYPE_DRIFT/);
});
