import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireSupplyApiSession } from "@/lib/auth/requireSupplySession";
import { isValidDate } from "@/lib/data/eggs/eggAvailability";
import { getSupplyRepository } from "@/lib/data/supplies/supplyRepositoryFactory";
import { runSupplyRequest } from "@/lib/data/eggSupplyComposition";
import { SupplyItemNotFoundError, SupplyRentalConflictError } from "@/lib/data/supplies/supplyRepository";
import { isSupplyCategory } from "@/lib/data/supplies/supplyTypes";
import type { SupplyRentalInput } from "@/lib/data/supplies/supplyTypes";

export const dynamic = "force-dynamic";

async function activityPOST(request: Request) {
  const session = await requireSupplyApiSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "지금은 관리자만 사용할 수 있습니다." }, { status: 403 });
  }
  const actorEmail = session.user?.email ?? "";

  let body: Partial<SupplyRentalInput>;
  try {
    body = (await request.json()) as Partial<SupplyRentalInput>;
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const category = body.category;
  const itemIds = Array.isArray(body.itemIds)
    ? Array.from(new Set(body.itemIds.filter((id): id is string => typeof id === "string" && id.length > 0)))
    : [];
  const borrowerName = body.borrowerName?.trim();
  const courseName = body.courseName?.trim();
  const startDate = body.startDate?.trim();
  const returnDueDate = body.returnDueDate?.trim();

  if (!isSupplyCategory(category)) {
    return NextResponse.json({ ok: false, error: "물품 종류가 올바르지 않습니다." }, { status: 400 });
  }

  if (itemIds.length === 0 || !borrowerName || !courseName) {
    return NextResponse.json(
      { ok: false, error: "빌릴 물품, 대여자, 과정명은 반드시 입력해야 합니다." },
      { status: 400 }
    );
  }

  if (!isValidDate(startDate) || !isValidDate(returnDueDate)) {
    return NextResponse.json(
      { ok: false, error: "대여 시작일과 반납 예정일을 정확히 입력해주세요." },
      { status: 400 }
    );
  }

  if (returnDueDate < startDate) {
    return NextResponse.json(
      { ok: false, error: "반납 예정일이 대여 시작일보다 앞설 수 없습니다." },
      { status: 400 }
    );
  }

  try {
    // 화면에서 이미 확인했더라도, 그 사이 다른 사람이 먼저 예약했을 수 있다.
    // 저장소가 물품 확인·겹침 확인·저장을 한 트랜잭션에서 해서, 동시에 같은 기간을 예약해도 하나만 저장된다.
    const created = await getSupplyRepository().createRental(
      {
        category,
        itemIds,
        borrowerName,
        borrowerEmail: body.borrowerEmail?.trim() || actorEmail || null,
        courseName,
        startDate,
        returnDueDate,
        note: body.note?.trim() || null
      },
      actorEmail
    );

    return NextResponse.json({ ok: true, rental: created }, { status: 201 });
  } catch (error) {
    if (error instanceof SupplyItemNotFoundError) {
      return NextResponse.json({ ok: false, error: "선택한 물품을 찾을 수 없습니다." }, { status: 400 });
    }
    if (error instanceof SupplyRentalConflictError) {
      const detail = error.conflicts
        .map((rental) => `${rental.startDate}~${rental.returnDueDate} ${rental.borrowerName}`)
        .join(", ");
      return NextResponse.json(
        { ok: false, error: `이미 예약된 기간과 겹칩니다. (${detail})` },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "예약 저장에 실패했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const POST = withActivity("/api/supplies/rentals", "POST", activityPOST, runSupplyRequest);
