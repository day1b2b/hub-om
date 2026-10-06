/** Diagnoses unmatched coach engagements. Displayed names are an authorized CLI response. */
import { config } from "dotenv";
import { runCoachOperationDiagnoseCommand } from "../src/lib/data/coachOperationMatchCommand";
import { runCoachOperationMatchCli } from "../src/lib/data/coachOperationMatchCliRuntime";

async function main(): Promise<void> {
  const result = await runCoachOperationMatchCli(process.argv.slice(2), process.env, runCoachOperationDiagnoseCommand, () => {
    config({ path: ".env.local" }); config({ path: ".env" });
  });
  console.log(`[diagnose-coach-operation-matches] 전체 ${result.counts.total}건 / 연결 ${result.counts.matched}건 / 미연결 ${result.counts.unmatched}건`);
  console.log("\n[미연결 course_name 상위]"); console.table(result.topCourseNames);
  console.log(`\n[미연결 후보 상위 ${result.limit}건]`); console.table(result.rows);
}

main().catch(() => { console.error("[diagnose-coach-operation-matches] 실패. 인자·저장소 설정·DB 연결을 점검하세요."); process.exitCode = 1; });
