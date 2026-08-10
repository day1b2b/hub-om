import { OnsiteRequired } from "@prisma/client";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getPrismaClient } from "@/lib/data/prisma";

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
export async function GET() {
  await assertAdminSession();

  const prisma = getPrismaClient();
  const targetCount = await prisma.operationSession.count({
    where: { deletedAt: null, onsiteRequired: { not: OnsiteRequired.Y } }
  });

  return NextResponse.json({ ok: true, targetCount });
}

export async function POST() {
  const session = await assertAdminSession();

  const prisma = getPrismaClient();
  const result = await prisma.operationSession.updateMany({
    where: { deletedAt: null, onsiteRequired: { not: OnsiteRequired.Y } },
    data: { onsiteRequired: OnsiteRequired.Y }
  });

  console.info(`[onsite-required-backfill] by=${session.user?.email ?? "unknown"} updated=${result.count}`);

  return NextResponse.json({ ok: true, updatedCount: result.count });
}
