import nextEnv from "@next/env";
import { runOperationImportCli } from "../src/lib/data/operationImportCliRuntime";
async function main() {
  const { options, result } = await runOperationImportCli(process.argv.slice(2), process.env, () => nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} }));
  console.log(`[operation-import] ${options.apply ? "apply" : "dry-run"}: 운영 ${result.operations}건 / 신규 ${result.inserted}건 / 갱신 ${result.updated}건 / 원천신규 ${result.sourceRecordsInserted}건 / 원천기존 ${result.sourceRecordsSkipped}건`);
}
main().catch((error: unknown) => { if (error instanceof Error && error.message === "OPERATION_IMPORT_CLEANUP_FAILED") console.error("[operation-import] 작업은 완료됐지만 연결 정리에 실패했습니다. 재실행 전에 저장 상태를 확인하세요.");
  else console.error("[operation-import] 실패. 입력·저장소 연결·백업 및 점검 확인을 점검하고, 적용 실행이었다면 저장 상태를 확인한 뒤 재시도하세요."); process.exitCode = 1; });
