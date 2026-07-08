/**
 * hub-om에 이관된 coach-db 데이터 상태를 읽기 전용으로 점검한다.
 *
 * 실행 위치:
 *   - Coolify hub-om 애플리케이션 터미널 (/app $)
 *
 * 실행:
 *   npm run db:verify:coach-data
 *
 * 필요 env:
 *   - DATABASE_URL: hub-om Postgres
 *   - COACH_DB_DATABASE_URL: 선택. 있으면 원본 coach-db live count도 비교한다.
 */

import { config } from "dotenv";
import pg from "pg";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

interface CountRow {
  label: string;
  count: number;
}

async function main(): Promise<void> {
  const targetUrl = process.env.DATABASE_URL;
  if (!targetUrl) {
    console.error("[verify-coach-data] DATABASE_URL이 없어 실행을 중단합니다.");
    process.exit(1);
  }

  const target = new Client({ connectionString: targetUrl });
  await target.connect();

  try {
    console.log("[verify-coach-data] hub-om 데이터 확인");
    await verifyTarget(target);
  } finally {
    await target.end();
  }

  if (process.env.COACH_DB_DATABASE_URL) {
    const source = new Client({ connectionString: process.env.COACH_DB_DATABASE_URL });
    await source.connect();
    try {
      console.log("\n[verify-coach-data] 원본 coach-db live count");
      console.table(await loadSourceCounts(source));
    } finally {
      await source.end();
    }
  } else {
    console.log("\n[verify-coach-data] COACH_DB_DATABASE_URL 없음: 원본 live count 비교는 건너뜀");
  }
}

async function verifyTarget(client: pg.Client): Promise<void> {
  const tableState = await loadTableState(client);
  assertCoreTables(tableState);

  const serviceCounts = await loadServiceCounts(client);
  console.log("\n[서비스 테이블]");
  console.table(serviceCounts);

  const latestImport = await client.query(
    `SELECT mode, status, coach_count, engagement_count, schedule_count,
            matched_operation_count, error_count, finished_at
       FROM coach_import_runs
      ORDER BY started_at DESC
      LIMIT 1`
  );
  console.log("\n[최근 import]");
  console.table(latestImport.rows);

  if (!tableState.get("coachdb_archive_snapshots") || !tableState.get("coachdb_archive_rows")) {
    console.log("\n[원본 아카이브] 테이블 없음: 아카이브 비교는 건너뜀");
    return;
  }

  const archiveSnapshot = await client.query<{ id: string; table_count: number; row_count: number; status: string; finished_at: Date | null }>(
    `SELECT id, table_count, row_count, status, finished_at
       FROM coachdb_archive_snapshots
      ORDER BY started_at DESC
      LIMIT 1`
  );

  const snapshot = archiveSnapshot.rows[0];
  if (!snapshot) {
    console.log("\n[원본 아카이브] 없음");
    return;
  }

  console.log("\n[최근 원본 아카이브]");
  console.table([{
    table_count: snapshot.table_count,
    row_count: snapshot.row_count,
    status: snapshot.status,
    finished_at: snapshot.finished_at
  }]);

  const archiveCounts = await loadArchiveCounts(client, snapshot.id);
  console.log("\n[원본 아카이브 주요 테이블]");
  console.table(archiveCounts);

  console.log("\n[원본 아카이브 ↔ 서비스 테이블 비교]");
  console.table(compareArchiveToService(archiveCounts, serviceCounts));
}

async function loadTableState(client: pg.Client): Promise<Map<string, boolean>> {
  const result = await client.query<{ table_name: string; exists: boolean }>(
    `SELECT name AS table_name, to_regclass('public.' || name) IS NOT NULL AS exists
       FROM unnest(ARRAY[
         'coaches',
         'coach_private_profiles',
         'coach_engagements',
         'coach_schedules',
         'coach_engagement_schedules',
         'coach_import_runs',
         'coachdb_archive_snapshots',
         'coachdb_archive_rows'
       ]) AS name`
  );

  return new Map(result.rows.map((row) => [row.table_name, row.exists]));
}

function assertCoreTables(tableState: Map<string, boolean>): void {
  const required = [
    "coaches",
    "coach_private_profiles",
    "coach_engagements",
    "coach_schedules",
    "coach_engagement_schedules",
    "coach_import_runs"
  ];
  const missing = required.filter((tableName) => !tableState.get(tableName));
  if (missing.length > 0) {
    throw new Error(`필수 테이블 없음: ${missing.join(", ")}`);
  }
}

async function loadServiceCounts(client: pg.Client): Promise<CountRow[]> {
  const result = await client.query<{
    coaches_total: number;
    coaches_visible: number;
    coaches_deleted: number;
    private_profiles: number;
    engagements: number;
    schedules: number;
    engagement_schedules: number;
    matched_engagements: number;
    unmatched_engagements: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM coaches) AS coaches_total,
       (SELECT count(*)::int FROM coaches WHERE deleted_at IS NULL) AS coaches_visible,
       (SELECT count(*)::int FROM coaches WHERE deleted_at IS NOT NULL) AS coaches_deleted,
       (SELECT count(*)::int FROM coach_private_profiles) AS private_profiles,
       (SELECT count(*)::int FROM coach_engagements) AS engagements,
       (SELECT count(*)::int FROM coach_schedules) AS schedules,
       (SELECT count(*)::int FROM coach_engagement_schedules) AS engagement_schedules,
       (SELECT count(*)::int FROM coach_engagements WHERE operation_session_id IS NOT NULL) AS matched_engagements,
       (SELECT count(*)::int FROM coach_engagements WHERE operation_session_id IS NULL) AS unmatched_engagements`
  );

  return toCountRows(result.rows[0]);
}

async function loadArchiveCounts(client: pg.Client, snapshotId: string): Promise<CountRow[]> {
  const result = await client.query<CountRow>(
    `SELECT table_name AS label, count(*)::int AS count
       FROM coachdb_archive_rows
      WHERE snapshot_id = $1
        AND table_name IN ('coaches', 'coach_private_profiles', 'engagements', 'coach_schedules', 'engagement_schedules')
      GROUP BY table_name
      ORDER BY table_name`,
    [snapshotId]
  );

  return result.rows;
}

async function loadSourceCounts(client: pg.Client): Promise<CountRow[]> {
  const result = await client.query<{
    coaches: number;
    engagements: number;
    coach_schedules: number;
    engagement_schedules: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM coaches) AS coaches,
       (SELECT count(*)::int FROM engagements) AS engagements,
       (SELECT count(*)::int FROM coach_schedules) AS coach_schedules,
       (SELECT count(*)::int FROM engagement_schedules) AS engagement_schedules`
  );

  return toCountRows(result.rows[0]);
}

function compareArchiveToService(archiveCounts: CountRow[], serviceCounts: CountRow[]) {
  const archive = new Map(archiveCounts.map((row) => [row.label, row.count]));
  const service = new Map(serviceCounts.map((row) => [row.label, row.count]));
  const pairs = [
    ["coaches", "coaches_total"],
    ["engagements", "engagements"],
    ["coach_schedules", "schedules"],
    ["engagement_schedules", "engagement_schedules"]
  ] as const;

  return pairs.map(([archiveLabel, serviceLabel]) => {
    const archiveCount = archive.get(archiveLabel) ?? 0;
    const serviceCount = service.get(serviceLabel) ?? 0;
    return {
      archive: archiveLabel,
      service: serviceLabel,
      archive_count: archiveCount,
      service_count: serviceCount,
      diff: serviceCount - archiveCount,
      ok: archiveCount === serviceCount
    };
  });
}

function toCountRows(row: Record<string, unknown>): CountRow[] {
  return Object.entries(row).map(([label, value]) => ({ label, count: Number(value) }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
