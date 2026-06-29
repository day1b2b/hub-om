/**
 * coach-db 원본 public 테이블 전체를 hub-om DB에 보관용으로 적재한다.
 *
 * 실행:
 *   npm run db:archive:coach-db -- --dry-run
 *   npm run db:archive:coach-db -- --apply
 *
 * 필요 env:
 *   - COACH_DB_DATABASE_URL: source coach-db read-only URL
 *   - DATABASE_URL: target hub-om URL
 *
 * 주의:
 *   - row_data에는 원본 row 전체가 들어간다. PII가 포함될 수 있으므로 화면에서 직접 사용하지 않는다.
 */

import { config } from "dotenv";
import pg from "pg";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

interface Options {
  apply: boolean;
}

interface SourceTable {
  table_schema: string;
  table_name: string;
}

interface SourceRow {
  row_key: string;
  row_data: Record<string, unknown>;
}

interface Summary {
  tableCount: number;
  rowCount: number;
}

function parseOptions(args: string[]): Options {
  return { apply: args.includes("--apply") };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const sourceUrl = process.env.COACH_DB_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;

  const missing: string[] = [];
  if (!sourceUrl) missing.push("COACH_DB_DATABASE_URL");
  if (!targetUrl) missing.push("DATABASE_URL");

  if (missing.length > 0) {
    console.error("[archive-coach-db] 필수 환경변수가 없어 실행을 중단합니다.");
    for (const name of missing) console.error(`  - 누락: ${name}`);
    process.exit(1);
  }

  if (!sourceUrl || !targetUrl) {
    process.exit(1);
  }

  const sourceConnectionUrl = sourceUrl;
  const targetConnectionUrl = targetUrl;

  console.log(`[archive-coach-db] 모드: ${options.apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);

  const source = new Client({ connectionString: sourceConnectionUrl });
  const target = new Client({ connectionString: targetConnectionUrl });

  await source.connect();
  await target.connect();

  try {
    const summary = await archiveCoachDb({
      apply: options.apply,
      source,
      sourceUrl: sourceConnectionUrl,
      target
    });

    console.log(
      `[archive-coach-db] ${options.apply ? "apply" : "dry-run"} 완료: ` +
        `테이블 ${summary.tableCount}개 / row ${summary.rowCount}건`
    );
  } finally {
    await source.end();
    await target.end();
  }
}

async function archiveCoachDb({
  apply,
  source,
  sourceUrl,
  target
}: {
  apply: boolean;
  source: pg.Client;
  sourceUrl: string;
  target: pg.Client;
}): Promise<Summary> {
  const tables = await loadSourceTables(source);
  const summary: Summary = { tableCount: tables.length, rowCount: 0 };

  if (!apply) {
    for (const table of tables) {
      const count = await countSourceRows(source, table);
      summary.rowCount += count;
      console.log(`  - ${table.table_schema}.${table.table_name}: ${count}건`);
    }
    return summary;
  }

  await target.query("BEGIN");
  let snapshotId: string | null = null;
  try {
    const snapshot = await target.query<{ id: string }>(
      `INSERT INTO coachdb_archive_snapshots (source_database, source_schema)
       VALUES ($1, 'public')
       RETURNING id`,
      [sanitizeDatabaseUrl(sourceUrl)]
    );
    snapshotId = snapshot.rows[0].id;

    for (const table of tables) {
      const primaryKeys = await loadPrimaryKeyColumns(source, table);
      const rows = await loadSourceRows(source, table, primaryKeys);
      await insertArchiveRows(target, snapshotId, table, rows);
      summary.rowCount += rows.length;
      console.log(`  - ${table.table_schema}.${table.table_name}: ${rows.length}건`);
    }

    await target.query(
      `UPDATE coachdb_archive_snapshots
       SET table_count = $1, row_count = $2, status = 'completed', finished_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [summary.tableCount, summary.rowCount, snapshotId]
    );
    await target.query("COMMIT");
    return summary;
  } catch (error) {
    if (snapshotId) {
      await target.query(
        `UPDATE coachdb_archive_snapshots
         SET status = 'failed', error_message = $1, finished_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [error instanceof Error ? error.message : String(error), snapshotId]
      );
    }
    await target.query("ROLLBACK");
    throw error;
  }
}

async function loadSourceTables(client: pg.Client): Promise<SourceTable[]> {
  const result = await client.query<SourceTable>(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );

  return result.rows;
}

async function countSourceRows(client: pg.Client, table: SourceTable): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}`
  );
  return Number(result.rows[0].count);
}

async function loadPrimaryKeyColumns(client: pg.Client, table: SourceTable): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema = $1
       AND tc.table_name = $2
     ORDER BY kcu.ordinal_position`,
    [table.table_schema, table.table_name]
  );

  return result.rows.map((row) => row.column_name);
}

async function loadSourceRows(
  client: pg.Client,
  table: SourceTable,
  primaryKeys: string[]
): Promise<SourceRow[]> {
  const tableRef = `${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}`;
  const rowKeyExpression =
    primaryKeys.length > 0
      ? `concat_ws('|', ${primaryKeys.map((column) => `t.${quoteIdent(column)}::text`).join(", ")})`
      : "md5(row_to_json(t)::text)";

  const result = await client.query<SourceRow>(
    `SELECT ${rowKeyExpression} AS row_key, row_to_json(t)::jsonb AS row_data
     FROM ${tableRef} t`
  );

  return result.rows;
}

async function insertArchiveRows(
  client: pg.Client,
  snapshotId: string,
  table: SourceTable,
  rows: SourceRow[]
): Promise<void> {
  const batchSize = 500;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    if (batch.length === 0) continue;

    const values: string[] = [];
    const params: unknown[] = [];

    batch.forEach((row, index) => {
      const base = index * 5;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb)`);
      params.push(
        snapshotId,
        table.table_schema,
        table.table_name,
        row.row_key,
        JSON.stringify(row.row_data)
      );
    });

    await client.query(
      `INSERT INTO coachdb_archive_rows (snapshot_id, table_schema, table_name, row_key, row_data)
       VALUES ${values.join(", ")}
       ON CONFLICT (snapshot_id, table_schema, table_name, row_key) DO UPDATE SET
         row_data = EXCLUDED.row_data,
         archived_at = CURRENT_TIMESTAMP`,
      params
    );
  }
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sanitizeDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return "invalid-url";
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
