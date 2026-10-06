import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

async function activityGET() {
  await assertAdminSession();

  const prisma = getPrismaClient();
  const coaches = await prisma.coach.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true,
      name: true,
      workType: true,
      status: true,
      deletedAt: true,
      deletedBy: true
    }
  });

  return NextResponse.json({
    ok: true,
    coaches: coaches.map((coach) => ({
      ...coach,
      status: coach.status.toLowerCase(),
      deletedAt: coach.deletedAt?.toISOString() ?? null
    }))
  });
}

async function activityPUT(request: Request) {
  await assertAdminSession();

  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== "string") {
    return NextResponse.json({ ok: false, error: "코치 ID가 필요합니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const coach = await prisma.coach.update({
    where: { id: body.id },
    data: { deletedAt: null, deletedBy: null },
    select: { id: true, name: true }
  });

  return NextResponse.json({ ok: true, coach });
}

async function activityDELETE(request: Request) {
  await assertAdminSession();

  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== "string") {
    return NextResponse.json({ ok: false, error: "코치 ID가 필요합니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const coach = await prisma.coach.findUnique({
    where: { id: body.id },
    select: { id: true, deletedAt: true }
  });

  if (!coach?.deletedAt) {
    return NextResponse.json({ ok: false, error: "삭제된 코치만 영구삭제할 수 있습니다." }, { status: 400 });
  }

  await prisma.coach.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}

export const GET = withActivity("/api/admin/deleted-coaches", "GET", activityGET);

export const PUT = withActivity("/api/admin/deleted-coaches", "PUT", activityPUT);

export const DELETE = withActivity("/api/admin/deleted-coaches", "DELETE", activityDELETE);
