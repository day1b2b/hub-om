/**
 * 조직 개편으로 팀 명칭이 1팀/2팀 -> AX 1파트/AX 2파트로 바뀌면서,
 * team_users 테이블에 저장된 기존 team 값을 새 명칭으로 갱신한다.
 *
 * 실행:
 *   npm run db:backfill:team-user-team-labels -- --dry-run
 *   npm run db:backfill:team-user-team-labels -- --apply
 */

import { config } from "dotenv";
import { runTeamLabelBackfillCli } from "../src/lib/data/teamLabelBackfillCliRuntime";

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  console.log(`[backfill-team-user-team-labels] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);
  const summary = await runTeamLabelBackfillCli(process.argv.slice(2), process.env, () => { config({ path: ".env.local" }); config({ path: ".env" }); });
  for (const row of summary.rows) {
    console.log(summary.apply
      ? `[backfill-team-user-team-labels] apply: "${row.from}" -> "${row.to}" ${row.updatedCount}건 갱신`
      : `[backfill-team-user-team-labels] dry-run: "${row.from}" -> "${row.to}" 대상 ${row.targetCount}건`);
  }
}

main().catch(() => {
  console.error("[backfill-team-user-team-labels] 실패. 인자·저장소 설정·DB 연결을 점검하세요.");
  process.exitCode = 1;
});
