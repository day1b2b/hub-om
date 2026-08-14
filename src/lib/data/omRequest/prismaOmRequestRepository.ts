import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../prisma";
import type { OmRequestRepository } from "./omRequestRepository";
import type { OmRequest, OmRequestInput, OmRequestSession, YN } from "./omRequestTypes";

type Row = {
  id: string;
  assignedOm: string | null;
  operationId: string | null;
  team: string;
  ld: string;
  company: string;
  businessNumber: string | null;
  trainingType: string;
  courseId: string;
  courseName: string;
  courseCategoryMajor: string | null;
  courseCategory: string;
  tools: string | null;
  instructorName: string;
  syncupLink: string;
  driveLink: string;
  skillfloSetup: string;
  skillmatchSetup: string;
  onSiteOperation: string;
  coachRequest: string;
  totalSessions: number;
  sessions: Prisma.JsonValue;
  notes: string | null;
  createdAt: Date;
};

function toOmRequest(row: Row): OmRequest {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    status: row.assignedOm ? "배정완료" : "배정필요",
    assignedOm: row.assignedOm ?? undefined,
    operationId: row.operationId ?? undefined,
    team: row.team,
    ld: row.ld,
    company: row.company,
    businessNumber: row.businessNumber ?? undefined,
    trainingType: row.trainingType as OmRequest["trainingType"],
    courseId: row.courseId,
    courseName: row.courseName,
    courseCategoryMajor: row.courseCategoryMajor ?? undefined,
    courseCategory: row.courseCategory,
    tools: row.tools ?? undefined,
    instructorName: row.instructorName,
    syncupLink: row.syncupLink,
    driveLink: row.driveLink,
    skillfloSetup: row.skillfloSetup as YN,
    skillmatchSetup: row.skillmatchSetup as YN,
    onSiteOperation: row.onSiteOperation as YN,
    coachRequest: row.coachRequest as YN,
    totalSessions: row.totalSessions,
    sessions: (row.sessions ?? []) as unknown as OmRequestSession[],
    notes: row.notes ?? ""
  };
}

function toCreateData(input: OmRequestInput): Prisma.OmRequestCreateInput {
  return {
    team: input.team,
    ld: input.ld,
    company: input.company,
    businessNumber: input.businessNumber || null,
    trainingType: input.trainingType,
    courseId: input.courseId,
    courseName: input.courseName,
    courseCategoryMajor: input.courseCategoryMajor || null,
    courseCategory: input.courseCategory,
    tools: input.tools || null,
    instructorName: input.instructorName,
    syncupLink: input.syncupLink,
    driveLink: input.driveLink,
    skillfloSetup: input.skillfloSetup,
    skillmatchSetup: input.skillmatchSetup,
    onSiteOperation: input.onSiteOperation,
    coachRequest: input.coachRequest,
    totalSessions: input.totalSessions,
    sessions: input.sessions as unknown as Prisma.InputJsonValue,
    notes: input.notes || null
  };
}

export class PrismaOmRequestRepository implements OmRequestRepository {
  async listOmRequests(): Promise<OmRequest[]> {
    const rows = await getPrismaClient().omRequest.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toOmRequest);
  }

  async getOmRequest(id: string): Promise<OmRequest | null> {
    const row = await getPrismaClient().omRequest.findUnique({ where: { id } });
    return row ? toOmRequest(row) : null;
  }

  async createOmRequest(input: OmRequestInput): Promise<OmRequest> {
    const row = await getPrismaClient().omRequest.create({ data: toCreateData(input) });
    return toOmRequest(row);
  }

  async updateOmRequest(id: string, input: OmRequestInput): Promise<OmRequest | null> {
    try {
      const row = await getPrismaClient().omRequest.update({ where: { id }, data: toCreateData(input) });
      return toOmRequest(row);
    } catch {
      return null;
    }
  }

  async deleteOmRequest(id: string): Promise<boolean> {
    try {
      await getPrismaClient().omRequest.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async updateOmRequestAssignment(id: string, assignedOm: string | null): Promise<OmRequest | null> {
    try {
      const row = await getPrismaClient().omRequest.update({
        where: { id },
        data: { assignedOm: assignedOm?.trim() || null }
      });
      return toOmRequest(row);
    } catch {
      return null;
    }
  }

  async setOmRequestOperationId(id: string, operationId: string): Promise<void> {
    await getPrismaClient().omRequest.update({ where: { id }, data: { operationId } });
  }
}
