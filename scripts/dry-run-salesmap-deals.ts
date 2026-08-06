/**
 * Salesmap 딜을 읽어 "코스ID → 매출(금액 합산)"이 깨끗하게 나오는지 확인하는 드라이런.
 * DB에 아무것도 쓰지 않고, 콘솔에 요약만 출력한다.
 *
 * 준비: .env.local (또는 셸 환경변수)에 아래를 설정한다.
 *   SALESMAP_API_TOKEN=...              (필수)
 *   SALESMAP_FIELD_COURSE_ID=코스ID      (딜의 코스ID 커스텀 필드명, 기본 "코스ID")
 *   SALESMAP_FIELD_COMPANY=회사          (고객사 필드명, 기본 "고객사" → 우리는 "회사")
 *   SALESMAP_FIELD_COURSE_NAME=이름      (과정명 필드명, 없으면 딜 이름 사용)
 *   # (선택) 특정 파이프라인 단계만 보려면
 *   SALESMAP_DEAL_PIPELINE_NAME=...
 *   SALESMAP_DEAL_STAGE_NAME=...
 *
 * 실행:
 *   npm run salesmap:dry-run
 *
 * 무엇을 보나:
 *   ① 코스ID 붙은 딜이 어떤 단계에 있는지 → 실주/견적 단계가 보이면 확정단계 필터가 필요.
 *   ② 코스ID 하나에 딜이 여러 개인지 → 합산이 맞는지 확인.
 *   ③ 코스ID → 매출 합산 샘플 → 대시보드 매출 기준과 눈으로 대조.
 */

import { hasSalesmapConfig, summarizeSalesmapDeals } from "@/lib/sourceReads/salesmapSourceReader.ts";

async function loadEnv(): Promise<void> {
  try {
    const { config } = await import("dotenv");
    config({ path: ".env.local" });
    config({ path: ".env" });
  } catch {
    // dotenv 가 없으면 셸에 직접 설정한 환경변수를 그대로 사용한다.
  }
}

async function main(): Promise<void> {
  await loadEnv();

  if (!hasSalesmapConfig()) {
    console.error("[salesmap:dry-run] SALESMAP_API_TOKEN 이 없습니다. .env.local 에 토큰을 넣어주세요.");
    process.exit(1);
  }

  const summary = await summarizeSalesmapDeals();

  console.log(
    `[salesmap:dry-run] 전체 딜 ${summary.totalDeals} / 코스ID 있음 ${summary.withCourseId} · 없음 ${summary.withoutCourseId} / 고유 코스ID ${summary.distinctCourseIds}`
  );

  console.log("\n[① 코스ID 붙은 딜의 단계 분포 — 실주/견적 단계가 보이면 확정단계 필터 필요]");
  console.table(summary.stageBreakdownForCourseIdDeals);

  console.log("\n[② 코스ID 하나에 딜이 여러 개인 케이스 — 있으면 합산이 맞는지 확인]");
  if (summary.multiDealCourseIds.length === 0) {
    console.log("  없음 (코스ID : 딜 = 1 : 1)");
  } else {
    console.table(summary.multiDealCourseIds);
  }

  console.log("\n[③ 코스ID → 매출(금액 합산) 샘플 최대 15건 — 대시보드 매출 기준과 대조]");
  console.table(summary.aggregatedSample);
}

main().catch((error) => {
  console.error("[salesmap:dry-run] 실패:", error);
  process.exit(1);
});
