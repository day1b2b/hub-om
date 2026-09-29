import type { Prisma } from "@prisma/client";
import type { OmRequest, OmRequestInput, OmRequestSession, TrainingType, YN } from "./omRequestTypes";

export interface OmRequestRow {
  id: string;
  status: string;
  assignedOm: string | null;
  operationId: string | null;
  ldEmail: string | null;
  slackChannel: string | null;
  slackThreadTs: string | null;
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
  resultReportNeeded: string;
  totalSessions: number;
  sessions: unknown;
  notes: string;
  createdAt: Date;
}

export function toOmRequest(row: OmRequestRow): OmRequest {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    status: row.status === "배정완료" ? "배정완료" : "배정필요",
    assignedOm: row.assignedOm ?? undefined,
    operationId: row.operationId ?? undefined,
    ldEmail: row.ldEmail ?? undefined,
    slackChannel: row.slackChannel ?? undefined,
    slackThreadTs: row.slackThreadTs ?? undefined,
    team: row.team,
    ld: row.ld,
    company: row.company,
    businessNumber: row.businessNumber ?? undefined,
    trainingType: row.trainingType as TrainingType,
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
    resultReportNeeded: (row.resultReportNeeded as YN | undefined) ?? "N",
    totalSessions: row.totalSessions,
    sessions: (row.sessions as OmRequestSession[] | null) ?? [],
    notes: row.notes,
  };
}

// Prisma create/update용 컬럼 데이터(입력 필드만).
export function toInputData(input: OmRequestInput) {
  return {
    team: input.team,
    ld: input.ld,
    company: input.company,
    businessNumber: input.businessNumber ?? null,
    trainingType: input.trainingType,
    courseId: input.courseId,
    courseName: input.courseName,
    courseCategoryMajor: input.courseCategoryMajor ?? null,
    courseCategory: input.courseCategory,
    tools: input.tools ?? null,
    instructorName: input.instructorName,
    syncupLink: input.syncupLink,
    driveLink: input.driveLink,
    skillfloSetup: input.skillfloSetup,
    skillmatchSetup: input.skillmatchSetup,
    onSiteOperation: input.onSiteOperation,
    coachRequest: input.coachRequest,
    resultReportNeeded: input.resultReportNeeded,
    totalSessions: input.totalSessions,
    sessions: input.sessions as unknown as Prisma.InputJsonValue,
    notes: input.notes,
  };
}
