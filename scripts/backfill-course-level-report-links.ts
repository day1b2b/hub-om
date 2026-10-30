import { config } from "dotenv";
import { runCourseLevelReportLinksBackfillCli } from "../src/lib/data/courseLevelReportLinksBackfillCliRuntime";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  console.log(`[backfill-course-level-report-links] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);
  const summary = await runCourseLevelReportLinksBackfillCli(args, process.env, () => {
    config({ path: ".env.local" });
    config({ path: ".env" });
  });

  console.log(`[backfill-course-level-report-links] 과정 ${summary.courseCount}건, 실제 반영(과정 수) ${summary.updatedCourseCount}건`);
  for (const field of Object.keys(summary.summaryByField) as (keyof typeof summary.summaryByField)[]) {
    const counts = summary.summaryByField[field];
    console.log(
      `[backfill-course-level-report-links] ${field}: 이미 과정레벨 값 있음(보존) ${counts.preserved}건, 자동 반영 후보 ${counts.candidates}건, 충돌(수동확인 필요) ${counts.conflicts}건, 전부 비어있음 ${counts.empty}건`
    );
  }

  if (summary.conflicts.length > 0) {
    console.log(`[backfill-course-level-report-links] 충돌 ${summary.conflicts.length}건 (과정명/기업명만, 값은 출력하지 않음):`);
    for (const conflict of summary.conflicts) {
      console.log(`  - [${conflict.field}] ${conflict.companyName} / ${conflict.courseName} (courseRecordId=${conflict.courseRecordId})`);
    }
  }
}

main().catch(() => {
  console.error("[backfill-course-level-report-links] 실패. DB 연결과 실행 조건을 확인하세요.");
  process.exitCode = 1;
});
