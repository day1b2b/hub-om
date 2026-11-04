import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireSupplyApiSession } from "@/lib/auth/requireSupplySession";
import { getSupplyRepository } from "@/lib/data/supplies/prismaSupplyRepository";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

/** 반납 처리. 함께 빌린 물품은 한 번에 반납된다. */
async function activityPATCH(_request: Request, { params }: RouteContext) {
  const session = await requireSupplyApiSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "지금은 관리자만 사용할 수 있습니다." }, { status: 403 });
  }
  const actorEmail = session.user?.email ?? "";
  const { id } = await params;

  try {
    await getSupplyRepository().markReturned(id, actorEmail);
    return NextResponse.json({ ok: true });
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
    await getSupplyRepository().cancelRental(id, actorEmail);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "예약 취소에 실패했습니다." }, { status: 500 });
  }
}

export const PATCH = withActivity("/api/supplies/rentals/[id]", "PATCH", activityPATCH);

export const DELETE = withActivity("/api/supplies/rentals/[id]", "DELETE", activityDELETE);
