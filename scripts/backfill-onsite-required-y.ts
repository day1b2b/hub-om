/**
 * 기존에 등록된 운영 회차의 현장 투입(onsite_required) 값을 전부 Y로 맞춘다.
 * 완료/아카이빙된 과거 건을 포함해 소프트 삭제(deleted_at)되지 않은 전체 행이 대상이다.
 *
 * 실행:
 *   npm run db:backfill:onsite-required-y -- --dry-run
 *   npm run db:backfill:onsite-required-y -- --apply
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
    console.error("[backfill-onsite-required-y] DATABASE_URL이 없어 실행을 중단합니다.");
    process.exit(1);
  }

  console.log(`[backfill-onsite-required-y] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);

  const client = new Client({ connectionString: targetUrl });
  await client.connect();

  try {
    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM operation_sessions WHERE deleted_at IS NULL AND onsite_required <> 'Y'`
    );
    const affected = count.rows[0]?.count ?? "0";

    if (!apply) {
      console.log(`[backfill-onsite-required-y] dry-run: onsite_required != 'Y' 대상 ${affected}건 -> 'Y'로 변경 예정`);
      return;
    }

    const result = await client.query(
      `UPDATE operation_sessions SET onsite_required = 'Y' WHERE deleted_at IS NULL AND onsite_required <> 'Y'`
    );
    console.log(`[backfill-onsite-required-y] apply: ${result.rowCount ?? 0}건 갱신 (대상 ${affected}건)`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
