import nextEnv from "@next/env";
import { runSourceOnlyPromotionCli } from "../src/lib/data/sourceOnlyPromotionCliRuntime";

async function main() {
  const { options, result } = await runSourceOnlyPromotionCli(process.argv.slice(2), process.env, () => {
    nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  });
  console.log(`[source-only-promotion] ${options.apply ? "apply" : "dry-run"}: 원천 ${result.sourceRows}건 / 신규 ${result.promoted}건 / 기존연결 ${result.linkedExisting}건 / 차단 ${result.blocked}건`);
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.message === "SOURCE_ONLY_PROMOTION_CLEANUP_FAILED") {
    console.error("[source-only-promotion] 작업은 완료됐지만 연결 정리에 실패했습니다. 재실행 전에 저장 상태를 확인하세요.");
  } else {
    console.error("[source-only-promotion] 실패. 인자·저장소 연결·백업 및 점검 확인을 점검하고, 적용 실행이었다면 저장 상태를 확인한 뒤 재시도하세요.");
  }
  process.exitCode = 1;
});
