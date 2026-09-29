import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getOperationBackfillRepository } from "@/lib/data/operationBackfillRepositoryFactory";

export const dynamic = "force-dynamic";

/**
 * 기존에 등록된 운영 회차의 현장 투입(onsite_required)을 전부 Y로 맞추는 1회성 admin 도구.
 *
 * 안전 규칙 (docs/operations/db-write-safety.md):
 *   - 데이터 책임자 요청으로 도입된 기능이다.
 *   - 버튼 클릭으로만 실행한다(자동 배치 없음).
 *   - 완료/아카이빙 건을 포함해 소프트 삭제(deletedAt)되지 않은 전체 행이 대상이다.
 *   - 수정 필드는 onsiteRequired 하나뿐. 물리 삭제·스키마 변경 없음.
 */
async function activityGET() {
  await assertAdminSession();

  const targetCount = await getOperationBackfillRepository().countOnsiteRequiredTargets();

  return NextResponse.json({ ok: true, targetCount });
}

async function activityPOST() {
  await assertAdminSession();

  const updatedCount = await getOperationBackfillRepository().applyOnsiteRequiredBackfill();

  console.info(`[onsite-required-backfill] updated=${updatedCount}`);

  return NextResponse.json({ ok: true, updatedCount });
}

export const GET = withActivity("/api/admin/onsite-required-backfill", "GET", activityGET);

export const POST = withActivity("/api/admin/onsite-required-backfill", "POST", activityPOST);
