/** Links imported coach engagements to operation sessions. PostgreSQL is the default backend. */
import { config } from "dotenv";
import { runCoachOperationBackfillCommand } from "../src/lib/data/coachOperationMatchCommand";
import { runCoachOperationMatchCli } from "../src/lib/data/coachOperationMatchCliRuntime";

async function main(): Promise<void> {
  const args = process.argv.slice(2), apply = args.includes("--apply");
  console.log(`[backfill-coach-operation-matches] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);
  const summary = await runCoachOperationMatchCli(args, process.env, runCoachOperationBackfillCommand, () => {
    config({ path: ".env.local" }); config({ path: ".env" });
  });
  console.log(`[backfill-coach-operation-matches] ${summary.apply ? "apply" : "dry-run"} 완료: 검사 ${summary.checked}건 / 매칭 ${summary.matched}건 / 미매칭 ${summary.unmatched}건 / 업데이트 ${summary.updated}건`);
}

main().catch(() => { console.error("[backfill-coach-operation-matches] 실패. 인자·저장소 설정·DB 연결을 점검하세요."); process.exitCode = 1; });
