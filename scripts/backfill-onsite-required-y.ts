/**
 * 기존에 등록된 운영 회차의 현장 투입(onsite_required) 값을 전부 Y로 맞춘다.
 * 완료/아카이빙된 과거 건을 포함해 소프트 삭제(deleted_at)되지 않은 전체 행이 대상이다.
 *
 * 실행:
 *   npm run db:backfill:onsite-required-y -- --dry-run
 *   npm run db:backfill:onsite-required-y -- --apply
 */

import { config } from "dotenv";
import { runOnsiteRequiredBackfillCli } from "../src/lib/data/onsiteRequiredBackfillCliRuntime";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`[backfill-onsite-required-y] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);
  const summary = await runOnsiteRequiredBackfillCli(process.argv.slice(2), process.env, () => {
    config({ path: ".env.local" }); config({ path: ".env" });
  });
  console.log(summary.apply
    ? `[backfill-onsite-required-y] apply: ${summary.updatedCount}건 갱신 (대상 ${summary.targetCount}건)`
    : `[backfill-onsite-required-y] dry-run: onsite_required != 'Y' 대상 ${summary.targetCount}건 -> 'Y'로 변경 예정`);
}

main().catch(() => {
  console.error("[backfill-onsite-required-y] 실패. 인자·저장소 설정·DB 연결을 점검하세요.");
  process.exitCode = 1;
});
