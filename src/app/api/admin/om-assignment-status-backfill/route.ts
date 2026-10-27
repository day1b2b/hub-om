import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getOperationBackfillRepository } from "@/lib/data/operationBackfillRepositoryFactory";
import { runAdminMaintenanceRequest } from "@/lib/data/adminMaintenanceComposition";

export const dynamic = "force-dynamic";

/**
 * OM은 이미 배정됐는데 operationStatus가 "배정필요"에 멈춰있는 건을 맞추는 admin 도구.
 * 끝나지 않은 교육은 "배정예정", 이미 끝난 교육은 아카이빙 완료 여부에 따라
 * "회고완료"/"아카이빙필요"로 바꾼다(omStatusBackfillValue). 진행상태는 시간이 지나도
 * 저절로 바뀌지 않아서, 끝난 교육까지 "배정예정"으로 올리면 곧 시작할 교육처럼 보인다.
 *
 * 배경: om-request 자동 연결 운영건은 생성 시점에 operationStatus가 "배정필요"로
 * 고정되는데, syncAssignedOmToLinkedOperation이 OM 배정 완료 시 om 필드만 갱신하고
 * operationStatus는 갱신하지 않아 계속 "배정필요"로 남아있는 기존 건이 쌓여 있었다
 * (2026-08-19 대시보드 제보로 확인, 이후 syncAssignedOmToLinkedOperation 자체는 수정함).
 *
 * 안전 규칙 (docs/operations/db-write-safety.md):
 *   - 버튼 클릭으로만 실행한다(자동 배치 없음).
 *   - 수정 필드는 operationStatus 하나뿐. 물리 삭제·스키마 변경 없음.
 *   - OM 값이 실제 이름이 아니라 "배정필요" 같은 플레이스홀더 텍스트인 건은 대상에서 제외한다.
 *   - 소프트 삭제(deletedAt)된 행은 대상에서 제외한다.
 */
async function activityGET() {
  await assertAdminSession();

  const { total, planned, archiveNeeded, retrospectiveDone } = await getOperationBackfillRepository().previewOmAssignmentStatusBackfill();

  return NextResponse.json({ ok: true, targetCount: total, planned, archiveNeeded, retrospectiveDone });
}

async function activityPOST() {
  await assertAdminSession();

  const updatedCount = await getOperationBackfillRepository().applyOmAssignmentStatusBackfill();

  console.info(`[om-assignment-status-backfill] updated=${updatedCount}`);

  return NextResponse.json({ ok: true, updatedCount });
}

export const GET = withActivity("/api/admin/om-assignment-status-backfill", "GET", activityGET, runAdminMaintenanceRequest);

export const POST = withActivity("/api/admin/om-assignment-status-backfill", "POST", activityPOST, runAdminMaintenanceRequest);
