import { NextResponse } from "next/server";
import { CoachStatus, type Prisma } from "@prisma/client";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { normalizeCoachName } from "@/lib/coaches/accessToken";
import { logProfileEdit } from "@/lib/coaches/contentEntries";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { status?: unknown };
  const status = parseCoachStatus(body.status);

  if (!status) {
    return NextResponse.json({ ok: false, error: "상태 값이 올바르지 않습니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const existing = await prisma.coach.findUnique({
    where: { id },
    select: { id: true, deletedAt: true }
  });

  if (!existing || existing.deletedAt) {
    return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  }

  const coach = await prisma.coach.update({
    where: { id },
    data: { status },
    select: {
      id: true,
      status: true,
      isActive: true
    }
  });

  return NextResponse.json({
    ok: true,
    coach: {
      id: coach.id,
      status: coach.status.toLowerCase(),
      isActive: coach.isActive
    }
  });
}

export async function GET(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;
  const prisma = getPrismaClient();
  const coach = await prisma.coach.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      workType: true,
      status: true,
      statusNote: true,
      returnDate: true,
      selfNote: true,
      portfolioUrl: true,
      availabilityDetail: true,
      managerNote: true,
      dxTag: true,
      isActive: true,
      fields: { select: { tag: { select: { id: true, name: true } } } },
      curriculums: { select: { tag: { select: { id: true, name: true } } } },
      _count: { select: { engagements: true, schedules: true } }
    }
  });

  if (!coach) {
    return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    coach: {
      id: coach.id,
      name: coach.name,
      workType: coach.workType,
      status: coach.status.toLowerCase(),
      statusNote: coach.statusNote,
      returnDate: coach.returnDate ? toDateString(coach.returnDate) : null,
      selfNote: coach.selfNote,
      portfolioUrl: coach.portfolioUrl,
      availabilityDetail: coach.availabilityDetail,
      managerNote: coach.managerNote,
      dxTag: coach.dxTag,
      isActive: coach.isActive,
      fields: coach.fields.map((item) => item.tag),
      curriculums: coach.curriculums.map((item) => item.tag),
      engagementCount: coach._count.engagements,
      scheduleCount: coach._count.schedules
    }
  });
}

const PROFILE_FIELD_KEYS = [
  "name",
  "workType",
  "statusNote",
  "returnDate",
  "selfNote",
  "portfolioUrl",
  "availabilityDetail",
  "managerNote",
  "dxTag",
  "isActive",
  "fields",
  "curriculums"
] as const;

export async function PUT(request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const prisma = getPrismaClient();
  const existing = await prisma.coach.findUnique({
    where: { id },
    select: { id: true, deletedAt: true }
  });

  if (!existing || existing.deletedAt) {
    return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  }

  let name: string | undefined;
  if (body.name !== undefined) {
    const parsedName = stringValue(body.name);
    if (!parsedName) {
      return NextResponse.json({ ok: false, error: "이름이 필요합니다." }, { status: 400 });
    }
    name = parsedName;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const coach = await tx.coach.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name, normalizedName: normalizeCoachName(name) } : {}),
        ...(body.workType !== undefined ? { workType: stringValue(body.workType) } : {}),
        ...(body.status !== undefined ? { status: parseAnyCoachStatus(body.status) ?? CoachStatus.ACTIVE } : {}),
        ...(body.statusNote !== undefined ? { statusNote: stringValue(body.statusNote) } : {}),
        ...(body.returnDate !== undefined ? { returnDate: dateValue(body.returnDate) } : {}),
        ...(body.selfNote !== undefined ? { selfNote: stringValue(body.selfNote) } : {}),
        ...(body.portfolioUrl !== undefined ? { portfolioUrl: stringValue(body.portfolioUrl) } : {}),
        ...(body.availabilityDetail !== undefined ? { availabilityDetail: stringValue(body.availabilityDetail) } : {}),
        ...(body.managerNote !== undefined ? { managerNote: stringValue(body.managerNote) } : {}),
        ...(body.dxTag !== undefined ? { dxTag: stringValue(body.dxTag) } : {}),
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {})
      },
      select: { id: true, name: true }
    });

    if (
      body.employeeId !== undefined ||
      body.phone !== undefined ||
      body.email !== undefined ||
      body.birthDate !== undefined ||
      body.affiliation !== undefined
    ) {
      await tx.coachPrivateProfile.upsert({
        where: { coachId: id },
        create: {
          coachId: id,
          employeeId: stringValue(body.employeeId),
          phone: stringValue(body.phone),
          email: stringValue(body.email),
          birthDate: dateValue(body.birthDate),
          affiliation: stringValue(body.affiliation)
        },
        update: {
          ...(body.employeeId !== undefined ? { employeeId: stringValue(body.employeeId) } : {}),
          ...(body.phone !== undefined ? { phone: stringValue(body.phone) } : {}),
          ...(body.email !== undefined ? { email: stringValue(body.email) } : {}),
          ...(body.birthDate !== undefined ? { birthDate: dateValue(body.birthDate) } : {}),
          ...(body.affiliation !== undefined ? { affiliation: stringValue(body.affiliation) } : {})
        }
      });
    }

    if (body.fields !== undefined) {
      await replaceTags(tx, id, "fields", stringList(body.fields));
    }
    if (body.curriculums !== undefined) {
      await replaceTags(tx, id, "curriculums", stringList(body.curriculums));
    }

    return coach;
  });

  const changedFields = PROFILE_FIELD_KEYS.filter((key) => body[key] !== undefined);
  await logProfileEdit(id, changedFields, {
    email: session.user?.email ?? "",
    name: session.user?.name ?? session.user?.email ?? "매니저"
  });

  return NextResponse.json({ ok: true, coach: updated });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const prisma = getPrismaClient();

  const coach = await prisma.coach.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (!coach || coach.deletedAt) {
    return NextResponse.json({ ok: false, error: "코치를 찾을 수 없습니다." }, { status: 404 });
  }

  await prisma.coach.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: session.user?.email ?? null
    }
  });

  return NextResponse.json({ ok: true });
}

function parseCoachStatus(value: unknown): CoachStatus | null {
  if (value === "active") return CoachStatus.ACTIVE;
  if (value === "inactive") return CoachStatus.INACTIVE;
  return null;
}

function parseAnyCoachStatus(value: unknown): CoachStatus | null {
  if (value === "pending") return CoachStatus.PENDING;
  return parseCoachStatus(value);
}

async function replaceTags(
  tx: Prisma.TransactionClient,
  coachId: string,
  type: "fields" | "curriculums",
  names: string[]
) {
  if (type === "fields") {
    await tx.coachField.deleteMany({ where: { coachId } });
    for (const name of names) {
      const tag = await tx.coachFieldMaster.upsert({ where: { name }, create: { name }, update: {} });
      await tx.coachField.create({ data: { coachId, tagId: tag.id } });
    }
    return;
  }

  await tx.coachCurriculum.deleteMany({ where: { coachId } });
  for (const name of names) {
    const tag = await tx.coachCurriculumMaster.upsert({ where: { name }, create: { name }, update: {} });
    await tx.coachCurriculum.create({ data: { coachId, tagId: tag.id } });
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item))))
    : [];
}

function dateValue(value: unknown): Date | null {
  const text = stringValue(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return new Date(`${text}T00:00:00.000Z`);
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}
