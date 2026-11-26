/**
 * 운영현황 '실습코치' → 회차별 MANUAL 투입 백필. 기본 dry-run, --apply로 실제 쓰기.
 * PostgreSQL이 기본 백엔드. 라이브(Mongo-shadow) 적재는 --backend=mongodb-shadow로 선택한다.
 *
 * node --experimental-strip-types ... scripts/sync-session-coaches.ts            (Postgres dry-run)
 * node ... scripts/sync-session-coaches.ts -- --apply                            (Postgres apply)
 * node ... scripts/sync-session-coaches.ts -- --backend=mongodb-shadow           (라이브 Mongo dry-run)
 * node ... scripts/sync-session-coaches.ts -- --backend=mongodb-shadow --apply   (라이브 Mongo apply)
 *
 * Mongo 경로는 MONGODB_SHADOW_DATABASE·MONGODB_SHADOW_NAMESPACE·PII 암호화 env가 필요하다.
 */
import { config } from "dotenv";
import { runSessionCoachSyncCli } from "../src/lib/data/sessionCoachSyncCliRuntime";
import { runSessionCoachSync } from "../src/lib/coaches/sessionCoachSyncCommand";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const backend = args.find((value) => value.startsWith("--backend=")) ?? "postgres(기본)";
  console.log(`[sync-session-coaches] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"} / 백엔드: ${backend}`);

  // 기본(Postgres) 경로에서만 env를 로드하고 Prisma를 닫는다(커맨드가 scoped 유무로 처리). Mongo 경로는 CLI 런타임이 처리.
  const result = await runSessionCoachSyncCli(args, process.env, runSessionCoachSync, () => {
    config({ path: ".env.local" });
    config({ path: ".env" });
  });

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

main().catch((error) => {
  console.error("[sync-session-coaches] 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
