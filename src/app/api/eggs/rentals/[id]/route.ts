import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireSupplyApiSession } from "@/lib/auth/requireSupplySession";
import { getEggRepository } from "@/lib/data/eggs/eggRepositoryFactory";
import { runEggRequest } from "@/lib/data/eggSupplyComposition";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

/** 반납 처리. 같은 에그의 이전 미반납 대여도 함께 닫고, 닫은 건수를 돌려준다 */
async function activityPATCH(_request: Request, { params }: RouteContext) {
  const session = await requireSupplyApiSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "지금은 관리자만 사용할 수 있습니다." }, { status: 403 });
  }
  const actorEmail = session.user?.email ?? "";
  const { id } = await params;

  try {
    const { returnedCount } = await getEggRepository().markReturned(id, actorEmail);
    return NextResponse.json({ ok: true, returnedCount });
  } catch {
    return NextResponse.json({ ok: false, error: "반납 처리에 실패했습니다." }, { status: 500 });
  }
}

/** 예약 취소. 실제 행을 지우지 않고 삭제 표시만 남긴다. */
async function activityDELETE(_request: Request, { params }: RouteContext) {
  const session = await requireSupplyApiSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "지금은 관리자만 사용할 수 있습니다." }, { status: 403 });
  }
  const actorEmail = session.user?.email ?? "";
  const { id } = await params;

  try {
    await getEggRepository().cancelRental(id, actorEmail);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "예약 취소에 실패했습니다." }, { status: 500 });
  }
}

export const PATCH = withActivity("/api/eggs/rentals/[id]", "PATCH", activityPATCH, runEggRequest);

export const DELETE = withActivity("/api/eggs/rentals/[id]", "DELETE", activityDELETE, runEggRequest);
