/** 운영현황 '실습코치' → 회차별 MANUAL 투입 백필. 기본 dry-run, --apply로 실제 쓰기. PostgreSQL 기본 백엔드. */
import { config } from "dotenv";
import { runSessionCoachSync } from "../src/lib/coaches/sessionCoachSyncCommand";
import { disconnectPrismaClient } from "../src/lib/data/prisma";

async function main(): Promise<void> {
  config({ path: ".env.local" });
  config({ path: ".env" });
  const apply = process.argv.slice(2).includes("--apply");
  console.log(`[sync-session-coaches] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);

  const result = await runSessionCoachSync({ apply });
  console.log(
    `[sync-session-coaches] ${result.apply ? "apply" : "dry-run"} 완료: ` +
      `회차 ${result.checkedSessions} / 생성 ${result.created} / 전환(SHEET→MANUAL) ${result.converted} / ` +
      `재활성 ${result.reactivated} / 취소 ${result.cancelled} / 미매칭 회차 ${result.unmatched.length}`
  );

  const sample = result.unmatched.slice(0, 20);
  if (sample.length > 0) {
    console.log("[sync-session-coaches] 미매칭(코치위키에서 못 찾은 이름) 예시 (최대 20건):");
    for (const item of sample) console.log(`  - ${item.operationSessionId}: ${item.names.join(", ")}`);
  }
}

main()
  .then(() => disconnectPrismaClient())
  .catch(async (error) => {
    console.error("[sync-session-coaches] 실패:", error instanceof Error ? error.message : error);
    await disconnectPrismaClient();
    process.exitCode = 1;
  });
