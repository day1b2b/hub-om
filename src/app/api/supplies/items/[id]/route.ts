import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { runSupplyRequest } from "@/lib/data/eggSupplyComposition";
import { parseSupplyItemInput } from "@/lib/data/supplies/supplyItemInput";
import { SupplyItemNotFoundError } from "@/lib/data/supplies/supplyRepository";
import { getSupplyRepository } from "@/lib/data/supplies/supplyRepositoryFactory";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 물품 정보 수정은 관리자(ADMIN_EMAILS)만 가능하다. */
async function activityPATCH(request: Request, { params }: RouteContext) {
  try {
    await assertAdminSession();
  } catch {
    return NextResponse.json({ ok: false, error: "물품 수정은 관리자만 할 수 있습니다." }, { status: 403 });
  }
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const parsed = parseSupplyItemInput(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  try {
    const item = await getSupplyRepository().updateItem(id, parsed.value);
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    if (error instanceof SupplyItemNotFoundError) {
      return NextResponse.json({ ok: false, error: "수정할 물품을 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "물품 수정에 실패했습니다." }, { status: 500 });
  }
}

export const PATCH = withActivity("/api/supplies/items/[id]", "PATCH", activityPATCH, runSupplyRequest);
