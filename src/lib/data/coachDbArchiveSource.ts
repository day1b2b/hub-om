import pg from "pg";
import type { CoachDbArchiveInput, CoachDbArchiveRow } from "./coachDbArchiveRepository";
const { Client } = pg;
type Table = { table_schema: string; table_name: string };
function ident(value: string) { return `"${value.replaceAll('"', '""')}"`; }
function sourceIdentity(): string { return "configured-postgresql-source"; }
export async function readCoachDbArchiveSource(connectionString: string, includeRows: boolean): Promise<CoachDbArchiveInput> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000,
    options: "-c default_transaction_read_only=on -c statement_timeout=120000 -c idle_in_transaction_session_timeout=120000" });
  try {
    await client.connect();
    const mode = await client.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
    if (mode.rows[0]?.transaction_read_only !== "on") throw new Error("SOURCE_NOT_READ_ONLY");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query<Table>(`SELECT table_schema, table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
    const tables: CoachDbArchiveInput["tables"] = [];
    for (const table of result.rows) {
      const ref = `${ident(table.table_schema)}.${ident(table.table_name)}`;
      const count = Number((await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${ref}`)).rows[0]?.count ?? 0);
      const rows: CoachDbArchiveRow[] = [];
      if (includeRows) {
        const primary = await client.query<{ column_name: string }>(`SELECT kcu.column_name FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position`, [table.table_schema, table.table_name]);
        const expression = primary.rows.length ? `concat_ws('|', ${primary.rows.map(row => `t.${ident(row.column_name)}::text`).join(", ")})` : "md5(row_to_json(t)::text)";
        const rowResult = await client.query<CoachDbArchiveRow>(`SELECT ${expression} AS "rowKey", row_to_json(t)::jsonb AS "rowData" FROM ${ref} t`);
        for (const row of rowResult.rows) rows.push(row);
        if (rows.length !== count || new Set(rows.map(row => row.rowKey)).size !== rows.length) throw new Error("SOURCE_ROW_KEY_MISMATCH");
      }
      tables.push({ schema: table.table_schema, name: table.table_name, rowCount: count, rows });
    }
    await client.query("COMMIT");
    return { sourceDatabase: sourceIdentity(), sourceSchema: "public", tables };
  } catch { await client.query("ROLLBACK").catch(() => {}); throw new Error("COACH_DB_ARCHIVE_SOURCE_FAILED"); }
  finally { await client.end().catch(() => {}); }
}
