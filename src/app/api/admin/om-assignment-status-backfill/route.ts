import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getOperationBackfillRepository } from "@/lib/data/operationBackfillRepositoryFactory";
import { runAdminMaintenanceRequest } from "@/lib/data/adminMaintenanceComposition";

export const dynamic = "force-dynamic";

/**
 * OM은 이미 배정됐는데 operationStatus가 "배정필요"에 멈춰있는 건을 "배정예정"으로
 * 맞추는 1회성 admin 도구.
 *
 * 배경: om-request 자동 연결 운영건은 생성 시점에 operationStatus가 "배정필요"로
 * 고정되는데, syncAssignedOmToLinkedOperation이 OM 배정 완료 시 om 필드만 갱신하고
 * operationStatus는 갱신하지 않아 계속 "배정필요"로 남아있는 기존 건이 쌓여 있었다
 * (2026-08-19 대시보드 제보로 확인, 이후 syncAssignedOmToLinkedOperation 자체는 수정함).
 *
 * 안전 규칙 (docs/operations/db-write-safety.md):
 *   - 버튼 클릭으로만 실행한다(자동 배치 없음).
 *   - 수정 필드는 operationStatus 하나뿐("배정필요" -> "배정예정"). 물리 삭제·스키마 변경 없음.
 *   - OM 값이 실제 이름이 아니라 "배정필요" 같은 플레이스홀더 텍스트인 건은 대상에서 제외한다.
 *   - 소프트 삭제(deletedAt)된 행은 대상에서 제외한다.
 */
async function activityGET() {
  await assertAdminSession();

  const targetCount = await getOperationBackfillRepository().countOmAssignmentStatusTargets();

  return NextResponse.json({ ok: true, targetCount });
}

async function activityPOST() {
  await assertAdminSession();

  const updatedCount = await getOperationBackfillRepository().applyOmAssignmentStatusBackfill();

  console.info(`[om-assignment-status-backfill] updated=${updatedCount}`);

  return NextResponse.json({ ok: true, updatedCount });
}

export const GET = withActivity("/api/admin/om-assignment-status-backfill", "GET", activityGET, runAdminMaintenanceRequest);

export const POST = withActivity("/api/admin/om-assignment-status-backfill", "POST", activityPOST, runAdminMaintenanceRequest);
