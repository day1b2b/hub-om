import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDates(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const dates = value.filter((v): v is string => typeof v === "string" && DATE_PATTERN.test(v));
  if (dates.length !== value.length) return null;
  return [...new Set(dates)];
}

function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

// 코치·날짜 조합 하나(단일 선택 화면)부터 여러 날짜(다중 선택 화면)까지 한 번에 예약/취소한다.
// 요청한 날짜별로 "최종적으로 누가 예약 중인지"를 항상 돌려줘서, 화면은 성공/충돌을 구분해
// 별도로 알릴 필요 없이 그 값을 그대로 표시에 반영하면 된다.
export async function POST(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { dates?: unknown };
  const dates = parseDates(body.dates);

  if (!dates) {
    return NextResponse.json({ ok: false, error: "날짜 값이 올바르지 않습니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const coach = await prisma.coach.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (!coach || coach.deletedAt) {
    return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  }

  const existingRows = await prisma.coachDayReservation.findMany({
    where: { coachId: id, date: { in: dates.map(toDbDate) }, cancelledAt: null },
    select: { date: true, reservedByName: true, reservedByEmail: true }
  });
  const existingByDate = new Map(
    existingRows.map((row) => [row.date.toISOString().slice(0, 10), row])
  );

  const datesToCreate = dates.filter((date) => !existingByDate.has(date));
  const reservedByName = session.user?.name ?? session.user?.email ?? "매니저";
  const reservedByEmail = session.user?.email ?? "";

  if (datesToCreate.length > 0) {
    await prisma.coachDayReservation.createMany({
      data: datesToCreate.map((date) => ({
        coachId: id,
        date: toDbDate(date),
        reservedByName,
        reservedByEmail
      }))
    });
  }

  const results = dates.map((date) => {
    const existing = existingByDate.get(date);
    return existing
      ? { date, reservedByName: existing.reservedByName, reservedByEmail: existing.reservedByEmail }
      : { date, reservedByName, reservedByEmail };
  });

  return NextResponse.json({ ok: true, results });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { dates?: unknown };
  const dates = parseDates(body.dates);

  if (!dates) {
    return NextResponse.json({ ok: false, error: "날짜 값이 올바르지 않습니다." }, { status: 400 });
  }

  const currentUserEmail = session.user?.email ?? "";

  const prisma = getPrismaClient();
  // 본인이 예약한 날짜만 취소한다. 다른 매니저의 예약 건은 대상에서 제외된다.
  const ownRows = await prisma.coachDayReservation.findMany({
    where: { coachId: id, date: { in: dates.map(toDbDate) }, cancelledAt: null, reservedByEmail: currentUserEmail },
    select: { id: true, date: true }
  });

  if (ownRows.length > 0) {
    await prisma.coachDayReservation.updateMany({
      where: { id: { in: ownRows.map((row) => row.id) } },
      data: { cancelledAt: new Date() }
    });
  }

  return NextResponse.json({ ok: true, cancelledDates: ownRows.map((row) => row.date.toISOString().slice(0, 10)) });
}
