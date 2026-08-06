/**
 * 조직 개편으로 팀 명칭이 1팀/2팀 -> AX 1파트/AX 2파트로 바뀌면서,
 * team_users 테이블에 저장된 기존 team 값을 새 명칭으로 갱신한다.
 *
 * 실행:
 *   npm run db:backfill:team-user-team-labels -- --dry-run
 *   npm run db:backfill:team-user-team-labels -- --apply
 */

import { config } from "dotenv";
import pg from "pg";

const { Client } = pg;

config({ path: ".env.local" });
config({ path: ".env" });

const apply = process.argv.includes("--apply");

const RENAMES: Array<{ from: string; to: string }> = [
  { from: "1팀", to: "AX 1파트" },
  { from: "2팀", to: "AX 2파트" }
];

async function main(): Promise<void> {
  const targetUrl = process.env.DATABASE_URL;
  if (!targetUrl) {
    console.error("[backfill-team-user-team-labels] DATABASE_URL이 없어 실행을 중단합니다.");
    process.exit(1);
  }

  console.log(`[backfill-team-user-team-labels] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);

  const client = new Client({ connectionString: targetUrl });
  await client.connect();

  try {
    for (const { from, to } of RENAMES) {
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM team_users WHERE team = $1`,
        [from]
      );
      const affected = count.rows[0]?.count ?? "0";

      if (!apply) {
        console.log(`[backfill-team-user-team-labels] dry-run: "${from}" -> "${to}" 대상 ${affected}건`);
        continue;
      }

      const result = await client.query(
        `UPDATE team_users SET team = $2 WHERE team = $1`,
        [from, to]
      );
      console.log(`[backfill-team-user-team-labels] apply: "${from}" -> "${to}" ${result.rowCount ?? 0}건 갱신`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
