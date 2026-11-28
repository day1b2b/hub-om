/**
 * 세일즈맵 딜 → hub-om 과정 매출(courses.revenue) 반영을 "앱 밖에서" 돌리는 배치 CLI.
 * 기본 dry-run(쓰기 없음), --apply로 실제 반영. 야간 스케줄/수동 '전체 재동기화' 트리거용.
 *
 * 쓰기 대상 백엔드는 SALES_SYNC_BACKEND를 따른다(라이브=mongodb-shadow). 로직은 라우트와 동일한
 * runSalesRevenueSync를 그대로 재사용하며, runSalesSyncRequest로 감싸 Mongo 런타임 안에서 돌린다.
 *
 * --apply 실행이 실패하거나 partial 등으로 반영이 막히면, SALES_SYNC_ALERT_EMAILS 대상에게
 * 슬랙 DM으로 알린다. 다만 새벽에 울리지 않도록 "다음 오전 9시(KST)"에 도착하게 예약한다.
 *
 * node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/sync-sales-revenue.ts            (dry-run)
 * node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/sync-sales-revenue.ts -- --apply (apply)
 */
import { config } from "dotenv";
import { runSalesRevenueSync, type SalesRevenueSyncResult } from "../src/lib/data/salesRevenueSync";
import { runSalesSyncRequest } from "../src/lib/data/salesSyncComposition";
import { notifySalesSyncFailureAt } from "../src/lib/data/salesRevenueNotifier";
import { nextKstNineAmEpochSeconds } from "../src/lib/data/salesSyncSchedule";
import { disconnectPrismaClient } from "../src/lib/data/prisma";

/** 야간 실패 알림 문구. result=null이면 실행 중 예외(원인 불명). */
function buildNightlyFailureText(result: SalesRevenueSyncResult | null): string {
  const head = ":chart_with_upwards_trend: 세일즈맵 매출 야간 자동 동기화";
  if (!result) {
    return `${head}\n:x: 어젯밤 동기화가 실패했어요. 관리자 화면에서 확인해 주세요.`;
  }
  if (!result.configured) {
    return `${head}\n:warning: 설정 문제로 실행되지 않았어요.\n원인: ${result.issues[0] ?? "세일즈맵 미설정"}`;
  }
  const reason = result.issues.join(" / ") || "세일즈맵을 일부만 읽어(partial) 반영을 막았어요.";
  return `${head}\n:warning: 어젯밤 매출을 반영하지 못했어요(기존 매출은 그대로예요).\n원인: ${reason}`;
}

async function main(): Promise<void> {
  config({ path: ".env.local" });
  config({ path: ".env" });

  const apply = process.argv.slice(2).includes("--apply");
  const backend = process.env.SALES_SYNC_BACKEND?.trim() || "postgres";
  console.log(`[sync-sales-revenue] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"} / backend: ${backend}`);

  // 실패 알림은 "다음 오전 9시(KST)"에 도착하도록 예약해 새벽 알림을 피한다.
  const alertPostAt = nextKstNineAmEpochSeconds(Date.now());

  const result = await runSalesSyncRequest(async () => {
    try {
      const r = await runSalesRevenueSync({ apply, actorEmail: "scheduled-job", multiDealResolutions: {} });
      // 자동 반영인데 미설정·partial 등으로 실제 쓰기가 막힌 경우 = 사람이 화면을 안 보므로 알린다.
      if (apply && (!r.configured || !r.applied)) {
        await notifySalesSyncFailureAt(buildNightlyFailureText(r), alertPostAt);
      }
      return r;
    } catch (error) {
      if (apply) await notifySalesSyncFailureAt(buildNightlyFailureText(null), alertPostAt);
      throw error;
    }
  });

  console.log(
    `[sync-sales-revenue] ${result.applied ? "apply" : "dry-run"} 완료: readStatus=${result.readStatus} / ` +
      `매출있는과정 읽음=${result.readCount} / 매칭=${result.matchedCourseIds} / ` +
      `채움=${result.filled} 변경=${result.changed} 그대로=${result.unchanged} 실제반영=${result.updatedRows}`
  );
  console.log(
    `[sync-sales-revenue] 미매칭 코스ID=${result.unmatchedCourseIds.length} / ` +
      `코스ID 여러 과정에 걸림=${result.multiCourseIds.length} / ` +
      `금액 다른 다중딜(검토 대상)=${result.multiDealCourseIds.length} / ` +
      `제외=${result.excludedCourseIds.length} / 금액 같은 중복 자동1건=${result.dedupedCourseIds.length}`
  );

  if (result.issues.length > 0) {
    console.log("[sync-sales-revenue] issues:");
    for (const issue of result.issues) console.log(`  - ${issue}`);
  }

  const sampleMulti = result.multiDealCourseIds.slice(0, 20);
  if (sampleMulti.length > 0) {
    console.log("[sync-sales-revenue] 금액 다른 다중딜 예시(최대 20건):");
    for (const m of sampleMulti) {
      console.log(
        `  - ${m.courseId} (${m.courseName ?? "?"} / ${m.companyName ?? "?"}): 딜 ${m.dealCount}개, ` +
          `합산 ${m.sum} / 최대 ${m.max} / 최소 ${m.min} → 적용 ${m.appliedAmount} (mode=${m.mode})`
      );
    }
  }
}

main()
  .then(() => disconnectPrismaClient())
  .catch(async (error) => {
    console.error("[sync-sales-revenue] 실패:", error instanceof Error ? error.message : error);
    await disconnectPrismaClient().catch(() => {});
    process.exitCode = 1;
  });
