import { randomUUID } from "node:crypto";
import { CoachStatus,type Prisma } from "@prisma/client";
import { generateCoachAccessToken,normalizeCoachName } from "../coaches/accessToken";
import { logProfileEdit } from "../coaches/contentEntries";
import { getPrismaClient } from "./prisma";
import { CoachManagementError,type CoachManagementRepository,type CoachManagementQuery,type CoachManagementAuthor } from "./coachManagementRepository";

const PROFILE_FIELD_KEYS=[
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

export class PrismaCoachManagementRepository implements CoachManagementRepository {
  async listCoaches(query: CoachManagementQuery) {
    const { search,field,page,limit }=query;
    const status=parseAnyCoachStatus(query.status);
    const prisma=getPrismaClient();
    const where={
      deletedAt: null,
      ...(status? { status }:{ status: { not: CoachStatus.PENDING } }),
      ...(search
        ? {
          OR: [
            { name: { contains: search,mode: "insensitive" as const } },
            { workType: { contains: search,mode: "insensitive" as const } }
          ]
        }
        :{}),
      ...(field? { fields: { some: { tag: { name: field } } } }:{})
    };

    const [coaches,total]=await Promise.all([
      prisma.coach.findMany({
        where,
        skip: (page-1)*limit,
        take: limit,
        select: {
          id: true,
          name: true,
          workType: true,
          status: true,
          isActive: true,
          fields: { select: { tag: { select: { id: true,name: true } } } },
          curriculums: { select: { tag: { select: { id: true,name: true } } } },
          engagements: {
            orderBy: { endDate: "desc" },
            take: 1,
            select: { courseName: true,endDate: true,rating: true }
          },
          _count: { select: { engagements: true } }
        },
        orderBy: [{ status: "asc" },{ normalizedName: "asc" }]
      }),
      prisma.coach.count({ where })
    ]);

    return {
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
          :null
      })),
      total
    };
  }
  async getCoach(id: string) {
    const prisma=getPrismaClient();
    const coach=await prisma.coach.findFirst({
      where: { id,deletedAt: null },
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
        fields: { select: { tag: { select: { id: true,name: true } } } },
        curriculums: { select: { tag: { select: { id: true,name: true } } } },
        _count: { select: { engagements: true,schedules: true } }
      }
    });

    if(!coach) {
      return null;
    }

    return {
      id: coach.id,
      name: coach.name,
      workType: coach.workType,
      status: coach.status.toLowerCase(),
      statusNote: coach.statusNote,
      returnDate: coach.returnDate? toDateString(coach.returnDate):null,
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
    };
  }
  async createCoach(body: Record<string,unknown>) {
    const name=stringValue(body.name);

    if(!name) {
      throw new CoachManagementError("COACH_NAME_REQUIRED");
    }

    const prisma=getPrismaClient();
    const coach=await prisma.$transaction(async (tx) => {
      const created=await tx.coach.create({
        data: {
          sourceCoachId: `hub:${randomUUID()}`,
          accessToken: generateCoachAccessToken(),
          name,
          normalizedName: normalizeCoachName(name),
          workType: stringValue(body.workType),
          status: parseAnyCoachStatus(body.status)??CoachStatus.ACTIVE,
          statusNote: stringValue(body.statusNote),
          returnDate: dateValue(body.returnDate),
          selfNote: stringValue(body.selfNote),
          portfolioUrl: stringValue(body.portfolioUrl),
          availabilityDetail: stringValue(body.availabilityDetail),
          managerNote: stringValue(body.managerNote)
        },
        select: { id: true,name: true }
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

      await replaceTags(tx,created.id,"fields",stringList(body.fields), false);
      await replaceTags(tx,created.id,"curriculums",stringList(body.curriculums), false);

      return created;
    });

    return coach;
  }
  async updateCoach(id: string,body: Record<string,unknown>,author: CoachManagementAuthor) {
    const prisma=getPrismaClient();
    const existing=await prisma.coach.findUnique({
      where: { id },
      select: { id: true,deletedAt: true }
    });

    if(!existing||existing.deletedAt) {
      throw new CoachManagementError("COACH_NOT_FOUND");
    }

    let name: string|undefined;
    if(body.name!==undefined) {
      const parsedName=stringValue(body.name);
      if(!parsedName) {
        throw new CoachManagementError("COACH_NAME_REQUIRED");
      }
      name=parsedName;
    }

    const updated=await prisma.$transaction(async (tx) => {
      const coach=await tx.coach.update({
        where: { id },
        data: {
          ...(name!==undefined? { name,normalizedName: normalizeCoachName(name) }:{}),
          ...(body.workType!==undefined? { workType: stringValue(body.workType) }:{}),
          ...(body.status!==undefined? { status: parseAnyCoachStatus(body.status)??CoachStatus.ACTIVE }:{}),
          ...(body.statusNote!==undefined? { statusNote: stringValue(body.statusNote) }:{}),
          ...(body.returnDate!==undefined? { returnDate: dateValue(body.returnDate) }:{}),
          ...(body.selfNote!==undefined? { selfNote: stringValue(body.selfNote) }:{}),
          ...(body.portfolioUrl!==undefined? { portfolioUrl: stringValue(body.portfolioUrl) }:{}),
          ...(body.availabilityDetail!==undefined? { availabilityDetail: stringValue(body.availabilityDetail) }:{}),
          ...(body.managerNote!==undefined? { managerNote: stringValue(body.managerNote) }:{}),
          ...(body.dxTag!==undefined? { dxTag: stringValue(body.dxTag) }:{}),
          ...(body.isActive!==undefined? { isActive: Boolean(body.isActive) }:{})
        },
        select: { id: true,name: true }
      });

      if(
        body.employeeId!==undefined||
        body.phone!==undefined||
        body.email!==undefined||
        body.birthDate!==undefined||
        body.affiliation!==undefined
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
            ...(body.employeeId!==undefined? { employeeId: stringValue(body.employeeId) }:{}),
            ...(body.phone!==undefined? { phone: stringValue(body.phone) }:{}),
            ...(body.email!==undefined? { email: stringValue(body.email) }:{}),
            ...(body.birthDate!==undefined? { birthDate: dateValue(body.birthDate) }:{}),
            ...(body.affiliation!==undefined? { affiliation: stringValue(body.affiliation) }:{})
          }
        });
      }

      if(body.fields!==undefined) {
        await replaceTags(tx,id,"fields",stringList(body.fields));
      }
      if(body.curriculums!==undefined) {
        await replaceTags(tx,id,"curriculums",stringList(body.curriculums));
      }

      return coach;
    });

    const changedFields=PROFILE_FIELD_KEYS.filter((key) => body[key]!==undefined);
    await logProfileEdit(id,changedFields,author);

    return updated;
  }
  async updateCoachStatus(id: string,value: unknown) {
    const status=parseCoachStatus(value);

    if(!status) {
      throw new CoachManagementError("INVALID_COACH_STATUS");
    }

    const prisma=getPrismaClient();
    const existing=await prisma.coach.findUnique({
      where: { id },
      select: { id: true,deletedAt: true }
    });

    if(!existing||existing.deletedAt) {
      throw new CoachManagementError("COACH_NOT_FOUND");
    }

    const coach=await prisma.coach.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        status: true,
        isActive: true
      }
    });

    return {
      id: coach.id,
      status: coach.status.toLowerCase(),
      isActive: coach.isActive
    };
  }
  async deleteCoach(id: string,deletedBy: string|null) {
    const prisma=getPrismaClient();

    const coach=await prisma.coach.findUnique({ where: { id },select: { id: true,deletedAt: true } });
    if(!coach||coach.deletedAt) {
      throw new CoachManagementError("COACH_NOT_FOUND");
    }

    await prisma.coach.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy
      }
    });


  }
}

function parseCoachStatus(value: unknown): CoachStatus|null {
  if(value==="active") return CoachStatus.ACTIVE;
  if(value==="inactive") return CoachStatus.INACTIVE;
  return null;
}

function parseAnyCoachStatus(value: unknown): CoachStatus|null {
  if(value==="pending") return CoachStatus.PENDING;
  return parseCoachStatus(value);
}

async function replaceTags(
  tx: Prisma.TransactionClient,
  coachId: string,
  type: "fields"|"curriculums",
  names: string[],
  replaceExisting = true
) {
  if(type==="fields") {
    await tx.coachField.deleteMany({ where: { coachId } });
    for(const name of names) {
      const tag=await tx.coachFieldMaster.upsert({ where: { name },create: { name },update: {} });
      await tx.coachField.create({ data: { coachId,tagId: tag.id } });
    }
    return;
  }

  if (replaceExisting) await tx.coachCurriculum.deleteMany({ where: { coachId } });
  for(const name of names) {
    const tag=await tx.coachCurriculumMaster.upsert({ where: { name },create: { name },update: {} });
    await tx.coachCurriculum.create({ data: { coachId,tagId: tag.id } });
  }
}

function stringValue(value: unknown): string|null {
  return typeof value==="string"&&value.trim()? value.trim():null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item))))
    :[];
}

function dateValue(value: unknown): Date|null {
  const text=stringValue(value);
  if(!text||!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return new Date(`${text}T00:00:00.000Z`);
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0,10);
}
