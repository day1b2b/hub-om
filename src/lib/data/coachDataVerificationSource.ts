import pg from "pg";
import type { VerificationCount } from "./coachDataVerificationRepository";
const { Client } = pg;

export async function readCoachSourceCounts(connectionString: string): Promise<VerificationCount[]> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000,
    options: "-c default_transaction_read_only=on -c statement_timeout=30000 -c idle_in_transaction_session_timeout=30000" });
  try {
    await client.connect();
    const mode = await client.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
    if (mode.rows[0]?.transaction_read_only !== "on") throw new Error("SOURCE_NOT_READ_ONLY");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query<Record<string, unknown>>(`SELECT
      (SELECT count(*)::int FROM coaches) AS coaches,
      (SELECT count(*)::int FROM engagements) AS engagements,
      (SELECT count(*)::int FROM coach_schedules) AS coach_schedules,
      (SELECT count(*)::int FROM engagement_schedules) AS engagement_schedules`);
    await client.query("COMMIT");
    return Object.entries(result.rows[0] ?? {}).map(([label, value]) => ({ label, count: Number(value) }));
  } catch { try { await client.query("ROLLBACK"); } catch {} throw new Error("COACH_SOURCE_VERIFICATION_FAILED"); }
  finally { await client.end().catch(() => {}); }
}
