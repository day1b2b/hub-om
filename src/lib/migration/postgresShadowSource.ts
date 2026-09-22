import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { mongoModelContracts, mongoModelNames, mongoSourceId, type MongoFieldContract } from "./mongoDocumentCodec";
import { privacyFields } from "../privacy/fields";

/** Inject a dedicated pg Pool. This module never reads credentials or opens a connection itself. */
export interface ShadowPgClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(destroy?: boolean): void;
}
export interface ShadowPgPool { connect(): Promise<ShadowPgClient> }
export interface PostgresShadowSnapshot {
  readonly snapshotId: string;
  readonly modelNames: readonly string[];
  rows(model: string): AsyncIterable<Record<string, unknown>>;
  sequenceHighWater(): Promise<Record<string, string>>;
}
export class PostgresShadowSourceError extends Error {
  readonly code: string;
  constructor(code: string) { super(`PostgreSQL shadow source failed: ${code}`); this.code = code; this.name = "PostgresShadowSourceError"; }
}
const check = (condition: unknown, code: string): void => { if (!condition) throw new PostgresShadowSourceError(code); };
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const fieldColumns = Object.fromEntries(Prisma.dmmf.datamodel.models.map(model => [model.name,
  Object.fromEntries(model.fields.filter(field => field.kind !== "object").map(field => [field.name, field.dbName ?? field.name]))]));
// Prisma 7's runtime DMMF omits enums; preserve @map labels from checked-in schema.
const publicSchema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const nativeUdt = Object.fromEntries([...publicSchema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)].map(([, name, body]) => [name,
  Object.fromEntries([...body.matchAll(/^\s+(\w+)\s+Int\??[^\n]*@db\.SmallInt\b/gm)].map(([, field]) => [field, "int2"]))]));
const enumMappings = Object.fromEntries([...publicSchema.matchAll(/^enum (\w+) \{\n([\s\S]*?)^\}/gm)].map(([, name, body]) => [name,
  Object.fromEntries([...body.matchAll(/^\s+(\w+)([^\n]*)$/gm)].map(([, value, attributes]) => [/\@map\("([^"\\]+)"\)/.exec(attributes)?.[1] ?? value, value]))]));
const companions = (model: string) => new Set(Object.values(privacyFields[model]?.fields ?? {}).flatMap(field => [field.index, field.storage].filter((name): name is string => Boolean(name))));
export const SOURCE_COLUMNS_SQL = `SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
 c.numeric_precision, c.numeric_scale, c.datetime_precision,
 ARRAY(SELECT e.enumlabel::text FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid
 JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=c.udt_schema AND t.typname=c.udt_name ORDER BY e.enumsortorder) AS enum_values
 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=ANY($1::text[])`;
export const SOURCE_PRIMARY_KEYS_SQL = `SELECT tc.table_name, array_agg(k.column_name::text ORDER BY k.ordinal_position) AS columns
 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k
 ON tc.constraint_catalog=k.constraint_catalog AND tc.constraint_schema=k.constraint_schema AND tc.constraint_name=k.constraint_name
 WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY' AND tc.table_name=ANY($1::text[]) GROUP BY tc.table_name`;
function validateType(field: MongoFieldContract, column: Record<string, unknown>, nativeType?: string) {
  const udt = nativeType ?? (field.list ? { String: "_text", Int: "_int4", DateTime: field.dateOnly ? "_date" : "_timestamp" }[field.type] :
    field.uuid ? "uuid" : { String: "text", Int: "int4", Boolean: "bool", Decimal: "numeric", Bytes: "bytea", Json: "jsonb", DateTime: field.dateOnly ? "date" : "timestamp" }[field.type]);
  check(column.is_nullable === (field.nullable ? "YES" : "NO"), "SOURCE_NULLABILITY_DRIFT");
  if (field.values) {
    const labels = enumMappings[field.type];
    check(labels && JSON.stringify(Object.values(labels).sort()) === JSON.stringify([...field.values].sort()), "SOURCE_ENUM_MAPPING_DRIFT");
    check(column.data_type === "USER-DEFINED" && Array.isArray(column.enum_values) && JSON.stringify([...column.enum_values].sort()) === JSON.stringify(Object.keys(labels).sort()), "SOURCE_ENUM_DRIFT");
  } else {
    check(column.udt_name === udt || (field.type === "DateTime" && !field.dateOnly && !field.list && column.udt_name === "timestamptz"), "SOURCE_TYPE_DRIFT");
  }
  if (field.type === "Decimal") check(column.numeric_precision === 14 && column.numeric_scale === 2, "SOURCE_DECIMAL_DRIFT");
  if (field.type === "DateTime" && !field.list && !field.dateOnly) check(column.datetime_precision === 3, "SOURCE_TIME_PRECISION_DRIFT");
}
function dateValue(value: unknown, field: MongoFieldContract): string | null {
  if (value === null) return null;
  check(typeof value === "string", "SOURCE_DATE_INVALID");
  const text = value as string;
  const normalized = field.dateOnly ? `${text}T00:00:00.000Z` : text.replace(" ", "T") + (/(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(text) ? "" : "Z");
  const date = new Date(normalized.replace(/([+-]\d\d)$/, "$1:00"));
  check(Number.isFinite(date.getTime()), "SOURCE_DATE_INVALID");
  return date.toISOString();
}

/** All 35 tables are read on one connection and one read-only repeatable snapshot.
 * The callback must await consumption; iterators are invalid after callback completion.
 * Source schema mismatch fails before any row is returned. Only absent PII companion
 * columns may be omitted, allowing a pre-encryption source without altering it.
 */
export async function withPostgresShadowSnapshot<T>(pool: ShadowPgPool, run: (source: PostgresShadowSnapshot) => Promise<T>, options: { batchSize?: number } = {}): Promise<T> {
  const batch = options.batchSize ?? 200;
  check(Number.isInteger(batch) && batch > 0 && batch <= 1000, "BATCH_SIZE");
  let client: ShadowPgClient;
  try { client = await pool.connect(); } catch { throw new PostgresShadowSourceError("CONNECT_FAILED"); }
  let active = true, started = false, busy = false, destroy = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); started = true;
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const snapshot = await client.query("SELECT pg_export_snapshot() AS snapshot_id");
    const snapshotId = snapshot.rows[0]?.snapshot_id;
    check(typeof snapshotId === "string" && snapshotId.length > 0, "SNAPSHOT_ID");
    const tables = mongoModelNames.map(name => mongoModelContracts[name].collection);
    const columns = (await client.query(SOURCE_COLUMNS_SQL, [tables])).rows;
    const primaryKeys = (await client.query(SOURCE_PRIMARY_KEYS_SQL, [tables])).rows;
    const present = new Map<string, Set<string>>();
    for (const name of mongoModelNames) {
      const model = mongoModelContracts[name], mapping = fieldColumns[name], optional = companions(name);
      const actual = columns.filter(column => column.table_name === model.collection);
      check(actual.length > 0 && actual.every(column => Object.values(mapping).includes(String(column.column_name))), "SOURCE_COLUMNS_DRIFT");
      const found = new Set<string>();
      for (const [field, contract] of Object.entries(model.fields)) {
        const matches = actual.filter(column => column.column_name === mapping[field]);
        if (!matches.length) { check(optional.has(field), "SOURCE_COLUMN_MISSING"); continue; }
        check(matches.length === 1, "SOURCE_COLUMNS_DRIFT"); validateType(contract, matches[0], nativeUdt[name]?.[field]); found.add(field);
      }
      check(JSON.stringify(primaryKeys.find(row => row.table_name === model.collection)?.columns) === JSON.stringify(model.primaryKey.map(field => mapping[field])), "SOURCE_PRIMARY_KEY_DRIFT");
      present.set(name, found);
    }
    const source: PostgresShadowSnapshot = {
      snapshotId: snapshotId as string, modelNames: mongoModelNames,
      async sequenceHighWater() {
        check(active && !busy, "SNAPSHOT_INACTIVE_OR_BUSY");
        const rows = (await client.query("SELECT schemaname, sequencename FROM pg_catalog.pg_sequences WHERE schemaname='public'")).rows;
        const values: Record<string, string> = {};
        for (const row of rows) {
          check(typeof row.sequencename === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(row.sequencename), "SOURCE_SEQUENCE_INVALID");
          const value = (await client.query(`SELECT last_value::text AS last_value, is_called FROM "public".${quote(row.sequencename as string)}`)).rows[0];
          check(typeof value?.last_value === "string" && /^-?\d+$/.test(value.last_value) && typeof value.is_called === "boolean", "SOURCE_SEQUENCE_INVALID");
          values[`public.${row.sequencename}`] = value.last_value as string;
        }
        return values;
      },
      async *rows(name) {
        check(active && !busy, "SNAPSHOT_INACTIVE_OR_BUSY"); check(Object.hasOwn(mongoModelContracts, name), "MODEL_UNKNOWN");
        busy = true;
        try {
          const model = mongoModelContracts[name], mapping = fieldColumns[name], fields = present.get(name)!;
          const projection = [...fields].flatMap(field => {
            const definition = model.fields[field], column = quote(mapping[field]);
            const expression = definition.type === "Decimal" || definition.type === "DateTime" ? (definition.list ? `to_json(${column})::text` : `${column}::text`) : column;
            return [`${expression} AS ${quote(field)}`, ...(definition.type === "Json" ? [`(${column} IS NULL) AS ${quote("__sql_null_" + field)}`] : [])];
          });
          const pk = model.primaryKey.map(field => quote(mapping[field]));
          let after: unknown[] | null = null;
          for (;;) {
            check(active, "SNAPSHOT_INACTIVE_OR_BUSY");
            const where: string = after ? ` WHERE (${pk.join(", ")}) > (${pk.map((_, index) => `$${index + 1}::uuid`).join(", ")})` : "";
            const values: unknown[] = after ? [...after, batch] : [batch];
            const page: Record<string, unknown>[] = (await client.query(`SELECT ${projection.join(", ")} FROM "public".${quote(model.collection)}${where} ORDER BY ${pk.join(", ")} LIMIT $${values.length}`, values)).rows;
            check(active && page.length <= batch, "SOURCE_PAGE_INVALID");
            if (!page.length) break;
            for (const row of page) {
              check(active, "SNAPSHOT_INACTIVE_OR_BUSY");
              const result: Record<string, unknown> = {};
              for (const field of fields) {
                const definition = model.fields[field];
                if (definition.type === "Json") {
                  check(typeof row["__sql_null_" + field] === "boolean", "SOURCE_JSON_NULL_INVALID");
                  result[field] = row["__sql_null_" + field] ? Prisma.DbNull : row[field] === null ? Prisma.JsonNull : row[field];
                } else if (definition.type === "DateTime") {
                  result[field] = definition.list ? (JSON.parse(row[field] as string) as unknown[]).map(value => dateValue(value, definition)) : dateValue(row[field], definition);
                } else if (definition.values && row[field] !== null) {
                  const labels = enumMappings[definition.type];
                  check(typeof row[field] === "string" && Object.hasOwn(labels, row[field] as string), "SOURCE_ENUM_VALUE_INVALID");
                  result[field] = labels[row[field] as string];
                } else result[field] = row[field];
              }
              yield result;
            }
            after = model.primaryKey.map((field): unknown => page[page.length - 1][field]);
            check(after.every(value => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value)), "SOURCE_CURSOR_INVALID");
            if (page.length < batch) break;
          }
        } finally { busy = false; }
      },
    };
    const result = await run(source);
    active = false;
    check(!busy, "UNCONSUMED_SOURCE_ITERATOR");
    await client.query("COMMIT"); started = false;
    return result;
  } catch (error) {
    active = false;
    if (started) { try { await client.query("ROLLBACK"); } catch { destroy = true; } }
    if (error instanceof PostgresShadowSourceError) throw error;
    throw new PostgresShadowSourceError("READ_FAILED");
  } finally { active = false; client.release(destroy); }
}


/** Lifecycle adapter for the immutable export writer; finish waits for actual COMMIT. */
export async function createPostgresShadowSnapshot(pool: ShadowPgPool): Promise<import("./postgresShadowExport").PostgresExportSnapshot> {
  let expose!: (source: PostgresShadowSnapshot) => void;
  let fail!: (reason: unknown) => void;
  const ready = new Promise<PostgresShadowSnapshot>((resolve, reject) => { expose = resolve; fail = reject; });
  let complete!: () => void, cancel!: (reason: unknown) => void;
  const lifecycle = new Promise<void>((resolve, reject) => { complete = resolve; cancel = reject; });
  const transaction = withPostgresShadowSnapshot(pool, async source => { expose(source); await lifecycle; });
  void transaction.catch(error => { fail(error); });
  const source = await ready;
  let closed = false, paging = false;
  const cursors = new Map<string, { iterator: AsyncIterator<Record<string, unknown>>; after: string | null }>();
  const closeIterators = async () => { for (const cursor of cursors.values()) await cursor.iterator.return?.(); };
  return {
    snapshotId: source.snapshotId, isolation: "repeatable-read", readOnly: true,
    async page(model, afterId, limit) {
      check(!closed && !paging && Number.isInteger(limit) && limit > 0 && limit <= 1000, "SOURCE_PAGE_INVALID");
      check(Object.hasOwn(mongoModelContracts, model), "MODEL_UNKNOWN");
      let cursor = cursors.get(model);
      if (!cursor) { check(afterId === null, "SOURCE_CURSOR_INVALID"); cursor = { iterator: source.rows(model)[Symbol.asyncIterator](), after: null }; cursors.set(model, cursor); }
      check(cursor.after === afterId, "SOURCE_CURSOR_INVALID");
      paging = true;
      try {
        const rows: Record<string, unknown>[] = [];
        while (rows.length < limit) {
          const next = await cursor.iterator.next();
          if (next.done) break;
          const id = mongoSourceId(model, next.value);
          check(cursor.after === null || id > cursor.after, "SOURCE_CURSOR_INVALID");
          cursor.after = id; rows.push(next.value);
        }
        return rows;
      } catch (error) {
        if (error instanceof PostgresShadowSourceError) throw error;
        throw new PostgresShadowSourceError("READ_FAILED");
      } finally { paging = false; }
    },
    async sequenceHighWater() {
      check(!closed && !paging, "SNAPSHOT_INACTIVE_OR_BUSY");
      try { return await source.sequenceHighWater(); }
      catch (error) { if (error instanceof PostgresShadowSourceError) throw error; throw new PostgresShadowSourceError("READ_FAILED"); }
    },
    async finish() {
      check(!closed && !paging, "SNAPSHOT_INACTIVE_OR_BUSY"); closed = true;
      try { await closeIterators(); complete(); await transaction; }
      catch (error) { cancel(error); try { await transaction; } catch { /* source releases on failure */ } throw new PostgresShadowSourceError("FINISH_FAILED"); }
    },
    async abort() {
      if (closed) return;
      closed = true;
      try { await closeIterators(); }
      finally { cancel(new PostgresShadowSourceError("EXPORT_ABORTED")); try { await transaction; } catch { /* transaction rolled back and released */ } }
    },
  };
}
