/**
 * 최신 coach-db 아카이브에서 hub-om 서비스 컬럼으로 승격된 코치 운영 데이터와
 * 스케줄 접속 로그를 백필한다.
 *
 * 실행:
 *   npm run db:backfill:coach-archive-service-data -- --dry-run
 *   npm run db:backfill:coach-archive-service-data -- --apply
 */

import { config } from "dotenv";
import pg from "pg";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  const targetUrl = process.env.DATABASE_URL;
  if (!targetUrl) {
    console.error("[backfill-coach-archive-service-data] DATABASE_URL이 없어 실행을 중단합니다.");
    process.exit(1);
  }

  console.log(`[backfill-coach-archive-service-data] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);

  const client = new Client({ connectionString: targetUrl });
  await client.connect();

  try {
    const summary = await client.query<{
      coach_rows: string;
      changed_coaches: string;
      access_log_rows: string;
    }>(`
      WITH latest_coaches AS (
        SELECT DISTINCT ON (ar.row_key)
          ar.row_key,
          ar.row_data
        FROM coachdb_archive_rows ar
        JOIN coachdb_archive_snapshots s ON s.id = ar.snapshot_id
        WHERE s.status = 'completed'
          AND ar.table_schema = 'public'
          AND ar.table_name = 'coaches'
        ORDER BY ar.row_key, s.started_at DESC
      ),
      latest_logs AS (
        SELECT DISTINCT ON (ar.row_key)
          ar.row_key,
          ar.row_data
        FROM coachdb_archive_rows ar
        JOIN coachdb_archive_snapshots s ON s.id = ar.snapshot_id
        WHERE s.status = 'completed'
          AND ar.table_schema = 'public'
          AND ar.table_name = 'schedule_access_logs'
        ORDER BY ar.row_key, s.started_at DESC
      )
      SELECT
        (SELECT count(*)::text FROM latest_coaches JOIN coaches c ON c.source_coach_id = latest_coaches.row_key) AS coach_rows,
        (
          SELECT count(*)::text
          FROM latest_coaches lc
          JOIN coaches c ON c.source_coach_id = lc.row_key
          WHERE c.access_token IS DISTINCT FROM lc.row_data->>'access_token'
             OR c.status_note IS DISTINCT FROM nullif(lc.row_data->>'status_note', '')
             OR c.self_note IS DISTINCT FROM nullif(lc.row_data->>'self_note', '')
             OR c.portfolio_url IS DISTINCT FROM nullif(lc.row_data->>'portfolio_url', '')
             OR c.availability_detail IS DISTINCT FROM nullif(lc.row_data->>'availability_detail', '')
             OR c.manager_note IS DISTINCT FROM nullif(lc.row_data->>'manager_note', '')
             OR c.dx_tag IS DISTINCT FROM nullif(lc.row_data->>'dx_tag', '')
        ) AS changed_coaches,
        (SELECT count(*)::text FROM latest_logs) AS access_log_rows
    `);

    const row = summary.rows[0];
    if (!apply) {
      console.log(
        `[backfill-coach-archive-service-data] dry-run 완료: 코치 ${row.coach_rows}건 / ` +
          `변경 필요 ${row.changed_coaches}건 / 접속로그 ${row.access_log_rows}건`
      );
      return;
    }

    await client.query("BEGIN");
    try {
      const coaches = await client.query(`
        WITH latest AS (
          SELECT DISTINCT ON (ar.row_key)
            ar.row_key,
            ar.row_data
          FROM coachdb_archive_rows ar
          JOIN coachdb_archive_snapshots s ON s.id = ar.snapshot_id
          WHERE s.status = 'completed'
            AND ar.table_schema = 'public'
            AND ar.table_name = 'coaches'
          ORDER BY ar.row_key, s.started_at DESC
        )
        UPDATE coaches c
        SET access_token = latest.row_data->>'access_token',
            status_note = nullif(latest.row_data->>'status_note', ''),
            return_date = nullif(left(coalesce(latest.row_data->>'return_date', ''), 10), '')::date,
            self_note = nullif(latest.row_data->>'self_note', ''),
            portfolio_url = nullif(latest.row_data->>'portfolio_url', ''),
            availability_detail = nullif(latest.row_data->>'availability_detail', ''),
            manager_note = nullif(latest.row_data->>'manager_note', ''),
            dx_tag = nullif(latest.row_data->>'dx_tag', ''),
            deleted_by = nullif(latest.row_data->>'deleted_by', ''),
            updated_at = CURRENT_TIMESTAMP
        FROM latest
        WHERE c.source_coach_id = latest.row_key
      `);

      const logs = await client.query(`
        WITH latest AS (
          SELECT DISTINCT ON (ar.row_key)
            ar.row_key,
            ar.row_data
          FROM coachdb_archive_rows ar
          JOIN coachdb_archive_snapshots s ON s.id = ar.snapshot_id
          WHERE s.status = 'completed'
            AND ar.table_schema = 'public'
            AND ar.table_name = 'schedule_access_logs'
          ORDER BY ar.row_key, s.started_at DESC
        )
        INSERT INTO coach_schedule_access_logs (
          source_access_log_id, coach_id, year_month, accessed_at, last_edited_at
        )
        SELECT
          latest.row_key,
          c.id,
          latest.row_data->>'year_month',
          (latest.row_data->>'accessed_at')::timestamp,
          nullif(latest.row_data->>'last_edited_at', '')::timestamp
        FROM latest
        JOIN coaches c ON c.source_coach_id = latest.row_data->>'coach_id'
        WHERE latest.row_data->>'year_month' IS NOT NULL
        ON CONFLICT (coach_id, year_month) DO UPDATE SET
          source_access_log_id = EXCLUDED.source_access_log_id,
          accessed_at = EXCLUDED.accessed_at,
          last_edited_at = EXCLUDED.last_edited_at
      `);

      await client.query("COMMIT");
      console.log(
        `[backfill-coach-archive-service-data] apply 완료: 코치 업데이트 ${coaches.rowCount ?? 0}건 / ` +
          `접속로그 upsert ${logs.rowCount ?? 0}건`
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
