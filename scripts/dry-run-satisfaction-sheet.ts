import nextEnv from "@next/env";
import { runSatisfactionDryRunCli } from "../src/lib/data/satisfactionDryRunCliRuntime";

async function main() {
  const result = await runSatisfactionDryRunCli(process.argv.slice(2), process.env, () => nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} }));
  console.log(`[satisfaction:dry-run] 시트 ${result.stats.total}행 / 운영 후보 ${result.candidates}건`);
  console.log(`  matched(자동연결 가능) ${result.stats.matched} · ambiguous(모호·수동확인) ${result.stats.ambiguous} · unmatched(후보없음) ${result.stats.unmatched}`);
  console.log("\n[matched — 자동으로 연결될 행]");
  console.table(result.results.filter(row => row.status === "matched").slice(0, result.limit).map(row => ({ course: row.row.course, instructor: row.row.instructor, date: row.row.date, overall: row.row.overall, posPct: row.row.posPct ?? "", n: row.row.respondents ?? "", operationId: row.operationId ?? "", score: row.ranked[0]?.score ?? 0 })));
  console.log("\n[ambiguous — 후보는 있으나 확신 부족(오매칭 방지로 보류)]");
  console.table(result.results.filter(row => row.status === "ambiguous").slice(0, result.limit).map(row => ({ course: row.row.course, instructor: row.row.instructor, date: row.row.date, top1: row.ranked[0] ? `${row.ranked[0].candidate.courseName}(${row.ranked[0].score})` : "", top2: row.ranked[1] ? `${row.ranked[1].candidate.courseName}(${row.ranked[1].score})` : "" })));
  console.log("\n[unmatched — 매칭 후보 없음(과정명/일정 확인 필요)]");
  console.table(result.results.filter(row => row.status === "unmatched").slice(0, result.limit).map(row => ({ course: row.row.course, instructor: row.row.instructor, date: row.row.date, courseId: row.row.courseId })));
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.message === "SATISFACTION_DRY_RUN_CLEANUP_FAILED") console.error("[satisfaction:dry-run] 조회는 끝났지만 연결 정리에 실패했습니다.");
  else console.error("[satisfaction:dry-run] 실패. 입력 파일과 저장소 연결을 확인하세요.");
  process.exitCode = 1;
});
