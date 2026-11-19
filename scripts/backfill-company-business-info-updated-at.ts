// 일회성 백필이라 npm 스크립트로 등록하지 않는다(package.json 해시가 import fixture 승인 목록에 묶여 있음).
// 실행: node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/backfill-company-business-info-updated-at.ts
//   --input=<json> --only-if-current-date=YYYY-MM-DD [--backend=mongodb-shadow] [--apply --backup-confirmed]
import { config } from "dotenv";
import { runCompanyBusinessInfoUpdatedAtBackfillCli } from "../src/lib/data/companyBusinessInfoUpdatedAtBackfillCliRuntime";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  console.log(`[backfill-company-business-info-updated-at] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);
  const summary = await runCompanyBusinessInfoUpdatedAtBackfillCli(args, process.env, () => {
    config({ path: ".env.local" });
    config({ path: ".env" });
  });

  const { counts } = summary;
  console.log(
    `[backfill-company-business-info-updated-at] 반영 대상 ${counts.candidate}건, 이미 같은 값 ${counts.already}건, 이후 직접 수정됨(보존) ${counts.changedSince}건, 없는 기업 ${counts.missing}건, 실제 반영 ${summary.updatedCount}건`
  );
  for (const item of summary.skipped) console.log(`  - [${item.status}] companyId=${item.companyId}`);
}

main().catch(() => {
  console.error("[backfill-company-business-info-updated-at] 실패. --input/--only-if-current-date 인자와 DB 연결을 확인하세요.");
  process.exitCode = 1;
});
