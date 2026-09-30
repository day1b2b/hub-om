/** 중복 회사의 과정·회차·코스ID명을 정상 회사로 원자적으로 병합한다. */
import nextEnv from "@next/env";
import { runDuplicateCompanyMergeCli } from "../src/lib/data/duplicateCompanyMergeCliRuntime";

async function main() {
  const { options, result } = await runDuplicateCompanyMergeCli(process.argv.slice(2), process.env, () => {
    nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  });
  console.log(`[merge-duplicate-company] 모드: ${options.apply ? "apply" : "dry-run"}`);
  console.log(`[merge-duplicate-company] 과정 ${result.courses.length}건, 코스ID명 ${result.labels.length}건`);
  for (const row of result.courses) console.log(`- [${row.courseId}] "${row.name}" (회차 ${row.sessionCount}건): ${row.action}`);
  for (const row of result.labels) console.log(`- 코스ID명 [${row.courseId}] "${row.label}": ${row.action}`);
  if (options.apply) console.log(`[merge-duplicate-company] 완료: 회차 ${result.updatedSessions}건, 과정 재할당 ${result.reassignedCourses}건, 과정 병합 ${result.mergedCourses}건, 라벨 재할당 ${result.reassignedLabels}건, 라벨 폐기 ${result.discardedLabels}건, source 잔여 과정 ${result.remainingCourses}건`);
  else console.log("[merge-duplicate-company] dry-run 완료. 적용에는 --apply --backup-confirmed --maintenance-confirmed가 모두 필요합니다.");
}
main().catch(() => { console.error("[merge-duplicate-company] 실패. 인자·백업/maintenance 확인·저장소 연결을 점검하세요. 트랜잭션 실패 시 전체 변경이 롤백됩니다."); process.exitCode = 1; });
