import { withActivity } from "@/lib/activity/request";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { repairActiveReservationIndex } from "@/lib/data/coachPortalDiagnosis";

export const dynamic = "force-dynamic";

/**
 * 코치 포털 진단 화면의 "인덱스 만들기" 버튼. CoachDayReservation에 활성 예약 인덱스(runtime_active_reservation) 1개만 만든다.
 *
 * 안전 규칙 (docs/operations/db-write-safety.md):
 *   - 버튼 클릭으로만 실행한다(자동 배치 없음).
 *   - 문서는 바꾸지 않는다. 같은 코치·같은 날짜의 활성 예약이 겹치면 만들지 않는다(중복 삭제 안 함).
 *   - 다른 collection·인덱스는 만들지 않는다(prepare 전체 실행 아님).
 */
async function activityPOST() {
  try { await assertAdminSession(); } catch { return Response.json({ ok: false, code: "ADMIN_REQUIRED" }, { status: 403 }); }
  const result = await repairActiveReservationIndex();
  console.info(`[coach-portal-reservation-index] ok=${result.ok} code=${result.code}`);
  return Response.json(result, { status: result.ok ? 200 : 409 });
}

export const POST = withActivity("/api/admin/coach-portal-diagnosis/reservation-index", "POST", activityPOST);
