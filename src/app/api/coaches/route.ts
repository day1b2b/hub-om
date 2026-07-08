import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { CoachStatus, type Prisma } from "@prisma/client";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { generateCoachAccessToken, normalizeCoachName } from "@/lib/coaches/accessToken";
import { getPrismaClient } from "@/lib/data/prisma";

export const dynamic = "force-dynamic";

interface CoachWriteBody {
  affiliation?: unknown;
  availabilityDetail?: unknown;
  birthDate?: unknown;
  curriculums?: unknown;
  email?: unknown;
  fields?: unknown;
  managerNote?: unknown;
  name?: unknown;
  phone?: unknown;
  portfolioUrl?: unknown;
  returnDate?: unknown;
  selfNote?: unknown;
  status?: unknown;
  statusNote?: unknown;
  workType?: unknown;
}

export async function GET(request: Request) {
  await requireWorkspaceSession();

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim();
  const field = searchParams.get("field")?.trim();
  const status = parseCoachStatus(searchParams.get("status"));
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 50) || 50));

  const prisma = getPrismaClient();
  const where = {
    deletedAt: null,
    ...(status ? { status } : { status: { not: CoachStatus.PENDING } }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { workType: { contains: search, mode: "insensitive" as const } }
          ]
        }
      : {}),
    ...(field ? { fields: { some: { tag: { name: field } } } } : {})
  };

  const [coaches, total] = await Promise.all([
    prisma.coach.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        workType: true,
        status: true,
        isActive: true,
        fields: { select: { tag: { select: { id: true, name: true } } } },
        curriculums: { select: { tag: { select: { id: true, name: true } } } },
        engagements: {
          orderBy: { endDate: "desc" },
          take: 1,
          select: { courseName: true, endDate: true, rating: true }
        },
        _count: { select: { engagements: true } }
      },
      orderBy: [{ status: "asc" }, { normalizedName: "asc" }]
    }),
    prisma.coach.count({ where })
  ]);

  return NextResponse.json({
    ok: true,
    coaches: coaches.map((coach) => ({
      id: coach.id,
      name: coach.name,
      workType: coach.workType,
      status: coach.status.toLowerCase(),
      isActive: coach.isActive,
      fields: coach.fields.map((item) => item.tag),
      curriculums: coach.curriculums.map((item) => item.tag),
      engagementCount: coach._count.engagements,
      latestEngagement: coach.engagements[0]
        ? {
            courseName: coach.engagements[0].courseName,
            endDate: toDateString(coach.engagements[0].endDate)
          }
        : null
    })),
    total
  });
}

export async function POST(request: Request) {
  await requireWorkspaceSession();

  const body = (await request.json().catch(() => ({}))) as CoachWriteBody;
  const name = stringValue(body.name);

  if (!name) {
    return NextResponse.json({ ok: false, error: "이름이 필요합니다." }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const coach = await prisma.$transaction(async (tx) => {
    const created = await tx.coach.create({
      data: {
        sourceCoachId: `hub:${randomUUID()}`,
        accessToken: generateCoachAccessToken(),
        name,
        normalizedName: normalizeCoachName(name),
        workType: stringValue(body.workType),
        status: parseCoachStatus(body.status) ?? CoachStatus.ACTIVE,
        statusNote: stringValue(body.statusNote),
        returnDate: dateValue(body.returnDate),
        selfNote: stringValue(body.selfNote),
        portfolioUrl: stringValue(body.portfolioUrl),
        availabilityDetail: stringValue(body.availabilityDetail),
        managerNote: stringValue(body.managerNote)
      },
      select: { id: true, name: true }
    });

    await tx.coachPrivateProfile.create({
      data: {
        coachId: created.id,
        employeeId: null,
        phone: stringValue(body.phone),
        email: stringValue(body.email),
        birthDate: dateValue(body.birthDate),
        affiliation: stringValue(body.affiliation)
      }
    });

    await replaceTags(tx, created.id, "fields", stringList(body.fields));
    await replaceTags(tx, created.id, "curriculums", stringList(body.curriculums));

    return created;
  });

  return NextResponse.json({ ok: true, coach }, { status: 201 });
}

async function replaceTags(
  tx: Prisma.TransactionClient,
  coachId: string,
  type: "fields" | "curriculums",
  names: string[]
) {
  if (names.length === 0) return;

  for (const name of names) {
    if (type === "fields") {
      const tag = await tx.coachFieldMaster.upsert({ where: { name }, create: { name }, update: {} });
      await tx.coachField.create({ data: { coachId, tagId: tag.id } });
    } else {
      const tag = await tx.coachCurriculumMaster.upsert({ where: { name }, create: { name }, update: {} });
      await tx.coachCurriculum.create({ data: { coachId, tagId: tag.id } });
    }
  }
}

function parseCoachStatus(value: unknown): CoachStatus | null {
  if (value === "active") return CoachStatus.ACTIVE;
  if (value === "inactive") return CoachStatus.INACTIVE;
  if (value === "pending") return CoachStatus.PENDING;
  return null;
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
