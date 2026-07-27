import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  await assertAdminSession();

  const prisma = getPrismaClient();
  const sessions = await prisma.operationSession.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    include: {
      course: {
        include: {
          company: true
        }
      }
    }
  });

  return NextResponse.json({
    ok: true,
    operations: sessions.map((session) => ({
      operationId: session.operationId,
      companyName: session.course.company.name,
      courseName: session.course.name,
      roundNo: session.roundNo,
      startDate: session.startDate.toISOString().slice(0, 10),
      endDate: session.endDate.toISOString().slice(0, 10),
      deletedAt: session.deletedAt?.toISOString() ?? null,
      deletedBy: session.deletedBy
    }))
  });
}

export async function PUT(request: Request) {
  await assertAdminSession();

  const body = (await request.json().catch(() => ({}))) as { operationId?: unknown };
  if (typeof body.operationId !== "string") {
    return NextResponse.json({ ok: false, error: "운영 차수 ID가 필요합니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const session = await prisma.operationSession.update({
    where: { operationId: body.operationId },
    data: { deletedAt: null, deletedBy: null },
    select: { operationId: true }
  });

  return NextResponse.json({ ok: true, operation: session });
}
