import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export async function POST(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { date?: unknown };
  const date = parseDate(body.date);

  if (!date) {
    return NextResponse.json({ ok: false, error: "날짜 값이 올바르지 않습니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const coach = await prisma.coach.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (!coach || coach.deletedAt) {
    return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  }

  const existing = await prisma.coachDayReservation.findFirst({
    where: { coachId: id, date: new Date(`${date}T00:00:00.000Z`), cancelledAt: null }
  });

  if (existing) {
    return NextResponse.json(
      { ok: false, error: "이미 예약된 날짜입니다.", reservedByName: existing.reservedByName },
      { status: 409 }
    );
  }

  const reservedByName = session.user?.name ?? session.user?.email ?? "매니저";
  const reservedByEmail = session.user?.email ?? "";

  const reservation = await prisma.coachDayReservation.create({
    data: {
      coachId: id,
      date: new Date(`${date}T00:00:00.000Z`),
      reservedByName,
      reservedByEmail
    }
  });

  return NextResponse.json({ ok: true, reservation: { reservedByName: reservation.reservedByName, reservedByEmail: reservation.reservedByEmail } });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();
  const { id } = await params;
  const url = new URL(request.url);
  const date = parseDate(url.searchParams.get("date"));

  if (!date) {
    return NextResponse.json({ ok: false, error: "날짜 값이 올바르지 않습니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const existing = await prisma.coachDayReservation.findFirst({
    where: { coachId: id, date: new Date(`${date}T00:00:00.000Z`), cancelledAt: null }
  });

  if (!existing) {
    return NextResponse.json({ ok: false, error: "예약을 찾을 수 없습니다." }, { status: 404 });
  }

  await prisma.coachDayReservation.update({
    where: { id: existing.id },
    data: { cancelledAt: new Date() }
  });

  return NextResponse.json({ ok: true });
}
