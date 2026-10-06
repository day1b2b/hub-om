/**
 * 최신 coach-db 아카이브에서 코치 입력 토큰(access_token)을 hub-om coaches 테이블로 백필한다.
 *
 * 실행:
 *   npm run db:backfill:coach-access-tokens -- --dry-run
 *   npm run db:backfill:coach-access-tokens -- --apply
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
    console.error("[backfill-coach-access-tokens] DATABASE_URL이 없어 실행을 중단합니다.");
    process.exit(1);
  }

  console.log(`[backfill-coach-access-tokens] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);

  const client = new Client({ connectionString: targetUrl });
  await client.connect();

  try {
    const summary = await client.query<{
      archived_tokens: string;
      missing_tokens: string;
      changed_tokens: string;
    }>(`
      WITH latest AS (
        SELECT DISTINCT ON (ar.row_key)
          ar.row_key,
          ar.row_data->>'access_token' AS access_token
        FROM coachdb_archive_rows ar
        JOIN coachdb_archive_snapshots s ON s.id = ar.snapshot_id
        WHERE s.status = 'completed'
          AND ar.table_schema = 'public'
          AND ar.table_name = 'coaches'
          AND ar.row_data->>'access_token' IS NOT NULL
        ORDER BY ar.row_key, s.started_at DESC
      )
      SELECT
        count(*)::text AS archived_tokens,
        count(*) FILTER (WHERE c.access_token IS NULL)::text AS missing_tokens,
        count(*) FILTER (WHERE c.access_token IS DISTINCT FROM latest.access_token)::text AS changed_tokens
      FROM latest
      JOIN coaches c ON c.source_coach_id = latest.row_key
    `);

    const row = summary.rows[0];
    if (!apply) {
      console.log(
        `[backfill-coach-access-tokens] dry-run 완료: 아카이브 토큰 ${row.archived_tokens}건 / ` +
          `신규 ${row.missing_tokens}건 / 변경 필요 ${row.changed_tokens}건`
      );
      return;
    }

    const result = await client.query<{ id: string }>(`
      WITH latest AS (
        SELECT DISTINCT ON (ar.row_key)
          ar.row_key,
          ar.row_data->>'access_token' AS access_token
        FROM coachdb_archive_rows ar
        JOIN coachdb_archive_snapshots s ON s.id = ar.snapshot_id
        WHERE s.status = 'completed'
          AND ar.table_schema = 'public'
          AND ar.table_name = 'coaches'
          AND ar.row_data->>'access_token' IS NOT NULL
        ORDER BY ar.row_key, s.started_at DESC
      )
      UPDATE coaches c
      SET access_token = latest.access_token,
          updated_at = CURRENT_TIMESTAMP
      FROM latest
      WHERE c.source_coach_id = latest.row_key
        AND c.access_token IS DISTINCT FROM latest.access_token
      RETURNING c.id
    `);

    console.log(
      `[backfill-coach-access-tokens] apply 완료: 아카이브 토큰 ${row.archived_tokens}건 / 업데이트 ${result.rowCount ?? 0}건`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
