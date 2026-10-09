import { config } from "dotenv";
import { runCourseCommonNoteBackfillCli } from "../src/lib/data/courseCommonNoteBackfillCliRuntime";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  console.log(`[backfill-course-common-notes] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);
  const summary = await runCourseCommonNoteBackfillCli(args, process.env, () => {
    config({ path: ".env.local" });
    config({ path: ".env" });
  });
  console.log(`[backfill-course-common-notes] 과정 ${summary.courseCount}건, 자동 반영 후보 ${summary.candidateCount}건, 직접 확인 필요 ${summary.conflictCourseCount}건, 기존 공통 값 보존 ${summary.skippedExistingFieldCount}개 항목, 실제 반영 ${summary.updatedCount}건`);
}

main().catch(() => {
  console.error("[backfill-course-common-notes] 실패. DB 연결과 실행 조건을 확인하세요.");
  process.exitCode = 1;
});
