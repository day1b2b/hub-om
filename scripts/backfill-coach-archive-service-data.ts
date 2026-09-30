/**
 * 최신 completed coach-db 아카이브의 코치 운영 필드와 일정 접속 로그를 백필한다.
 * PostgreSQL이 기본이며 명시적으로 준비한 Mongo shadow만 선택할 수 있다.
 *
 * npm run db:backfill:coach-archive-service-data -- --dry-run
 * npm run db:backfill:coach-archive-service-data -- --apply --backup-confirmed --maintenance-confirmed
 */
import nextEnv from "@next/env";
import { runCoachArchiveServiceBackfillCli } from "../src/lib/data/coachArchiveServiceBackfillCliRuntime";

async function main(): Promise<void> {
  const { options, summary } = await runCoachArchiveServiceBackfillCli(process.argv.slice(2), process.env, () => {
    nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  });
  if (options.apply) {
    console.log(`[backfill-coach-archive-service-data] apply 완료: 코치 업데이트 ${summary.updatedCoaches}건 / 접속로그 upsert ${summary.upsertedAccessLogs}건`);
  } else {
    console.log(`[backfill-coach-archive-service-data] dry-run 완료: 코치 ${summary.coachRows}건 / 변경 필요 ${summary.changedCoaches}건 / 접속로그 ${summary.accessLogRows}건`);
  }
}

main().catch(() => {
  console.error("[backfill-coach-archive-service-data] 실패. 인자·백업/maintenance 확인·암호화 설정·저장소 연결을 점검하세요. 트랜잭션 실패 시 전체 변경이 롤백됩니다.");
  process.exitCode = 1;
});
