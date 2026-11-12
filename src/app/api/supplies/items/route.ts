import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { runSupplyRequest } from "@/lib/data/eggSupplyComposition";
import { parseSupplyItemInput } from "@/lib/data/supplies/supplyItemInput";
import { getSupplyRepository } from "@/lib/data/supplies/supplyRepositoryFactory";

export const dynamic = "force-dynamic";

/** 물품 등록은 관리자(ADMIN_EMAILS)만 가능하다. */
async function activityPOST(request: Request) {
  try {
    await assertAdminSession();
  } catch {
    return NextResponse.json({ ok: false, error: "물품 등록은 관리자만 할 수 있습니다." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const parsed = parseSupplyItemInput(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  try {
    const item = await getSupplyRepository().createItem(parsed.value);
    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: false, error: "물품 등록에 실패했습니다." }, { status: 500 });
  }
}

export const POST = withActivity("/api/supplies/items", "POST", activityPOST, runSupplyRequest);
