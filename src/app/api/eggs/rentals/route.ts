import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireSupplyApiSession } from "@/lib/auth/requireSupplySession";
import { getConflicts, isValidDate } from "@/lib/data/eggs/eggAvailability";
import { getEggRepository } from "@/lib/data/eggs/prismaEggRepository";
import type { EggRentalInput } from "@/lib/data/eggs/eggTypes";

export const dynamic = "force-dynamic";

async function activityPOST(request: Request) {
  const session = await requireSupplyApiSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "지금은 관리자만 사용할 수 있습니다." }, { status: 403 });
  }
  const actorEmail = session.user?.email ?? "";

  let body: Partial<EggRentalInput>;
  try {
    body = (await request.json()) as Partial<EggRentalInput>;
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const eggDeviceId = body.eggDeviceId?.trim();
  const borrowerName = body.borrowerName?.trim();
  const courseName = body.courseName?.trim();
  const startDate = body.startDate?.trim();
  const returnDueDate = body.returnDueDate?.trim();

  if (!eggDeviceId || !borrowerName || !courseName) {
    return NextResponse.json(
      { ok: false, error: "에그, 대여자, 과정명은 반드시 입력해야 합니다." },
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

  const repository = getEggRepository();

  try {
    // 화면에서 이미 확인했더라도, 그 사이 다른 사람이 먼저 예약했을 수 있어 서버에서 다시 검사한다.
    const rentals = await repository.listRentals({ fromDate: startDate });
    const conflicts = getConflicts(rentals, eggDeviceId, startDate, returnDueDate);

    if (conflicts.length > 0) {
      const detail = conflicts
        .map((rental) => `${rental.startDate}~${rental.returnDueDate} ${rental.borrowerName}`)
        .join(", ");
      return NextResponse.json(
        { ok: false, error: `이미 예약된 기간과 겹칩니다. (${detail})` },
        { status: 409 }
      );
    }

    const created = await repository.createRental(
      {
        eggDeviceId,
        borrowerName,
        borrowerEmail: body.borrowerEmail?.trim() || actorEmail || null,
        courseName,
        startDate,
        returnDueDate,
        actualUseNote: body.actualUseNote?.trim() || null,
        note: body.note?.trim() || null
      },
      actorEmail
    );

    return NextResponse.json({ ok: true, rental: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "예약 저장에 실패했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const POST = withActivity("/api/eggs/rentals", "POST", activityPOST);
