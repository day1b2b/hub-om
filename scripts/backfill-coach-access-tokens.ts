/**
 * 최신 completed coach-db 아카이브의 non-null 코치 토큰을 암호화 repository로 백필한다.
 * 기본값은 읽기 전용이며 토큰/원천 행/DB 오류는 출력하지 않는다.
 *
 * npm run db:backfill:coach-access-tokens -- --dry-run
 * npm run db:backfill:coach-access-tokens -- --apply --backup-confirmed --maintenance-confirmed
 *
 * apply 전 백업·복구 확인 및 앱/원천 적재의 쓰기 중단이 필요하다.
 * 확인 플래그는 실제 maintenance를 수행하지 않는다. 전체 작업은 120초 제한의
 * 단일 트랜잭션이며 실패 시 전체 롤백한다. DB 규모별 소요 시간은 격리 DB에서 검증한다.
 */
import nextEnv from "@next/env";
import { getPrismaClient } from "../src/lib/data/prisma";
import { backfillCoachAccessTokens, parseCoachTokenBackfillArgs } from "../src/lib/data/coachAccessTokenBackfill";

async function main(): Promise<void> {
  const options = parseCoachTokenBackfillArgs(process.argv.slice(2));
  // Next's loader matches app environment precedence without a new dependency.
  nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const db = getPrismaClient();
  try {
    const summary = await backfillCoachAccessTokens(db, options);
    console.log(
      `[backfill-coach-access-tokens] ${options.apply ? "apply" : "dry-run"} 완료: ` +
      `아카이브 토큰 ${summary.archivedTokens}건 / 신규 ${summary.missingTokens}건 / ` +
      `변경 필요 ${summary.changedTokens}건 / 업데이트 ${summary.updatedTokens}건`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error("[backfill-coach-access-tokens] 실패. 인자·백업/maintenance 확인·암호화 설정·DB 연결을 점검하세요. 트랜잭션 실패 시 전체 변경이 롤백됩니다.");
  process.exitCode = 1;
});
