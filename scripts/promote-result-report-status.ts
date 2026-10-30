import { config } from "dotenv";
import { runResultReportStatusPromotionCli } from "../src/lib/data/resultReportStatusPromotionCliRuntime";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  console.log(`[promote-result-report-status] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);
  const summary = await runResultReportStatusPromotionCli(args, process.env, () => {
    config({ path: ".env.local" });
    config({ path: ".env" });
  });

  console.log(`[promote-result-report-status] 과정 ${summary.courseCount}건, 실제 반영(과정 수) ${summary.updatedCourseCount}건`);
  console.log(`[promote-result-report-status] 이미 과정레벨 값 있음(보존) ${summary.summary.preserved}건`);
  console.log(
    `[promote-result-report-status] 승격 결과 - 유 ${summary.summary.promotedYes}건, 무 ${summary.summary.promotedNo}건, 불필요 ${summary.summary.promotedNotRequired}건, 확인필요 ${summary.summary.promotedNeedsReview}건`
  );
}

main().catch(() => {
  console.error("[promote-result-report-status] 실패. DB 연결과 실행 조건을 확인하세요.");
  process.exitCode = 1;
});
