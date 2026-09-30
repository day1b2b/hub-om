/** coach-db 원천을 read-only snapshot으로 읽어 암호화 archive 저장소에 보관한다. */
import { config } from "dotenv";
import { runCoachDbArchiveCli } from "../src/lib/data/coachDbArchiveCliRuntime";
import { disconnectPrismaClient } from "../src/lib/data/prisma";
async function main() {
  config({ path: ".env.local" }); config({ path: ".env" });
  try {
    const { options, summary } = await runCoachDbArchiveCli(process.argv.slice(2), process.env, () => {});
    console.log(`[archive-coach-db] 모드: ${options.apply ? "apply" : "dry-run"}`);
    for (const table of summary.tables) console.log(`  - ${table.schema}.${table.name}: ${table.rowCount}건`);
    console.log(`[archive-coach-db] 완료: 테이블 ${summary.tableCount}개 / row ${summary.rowCount}건`);
  } finally { await disconnectPrismaClient(); }
}
void main().catch(() => { console.error("[archive-coach-db] 실행에 실패했습니다."); process.exitCode = 1; });
