import { randomUUID } from "node:crypto";
import {
  ArchiveStatus as PrismaArchiveStatus,
  EducationFormat as PrismaEducationFormat,
  OnsiteRequired as PrismaOnsiteRequired,
  OperationChannel as PrismaOperationChannel,
  OperationStatus as PrismaOperationStatus,
  OperationType as PrismaOperationType,
  ResultReportStatus as PrismaResultReportStatus,
  SatisfactionSurveyStatus as PrismaSatisfactionSurveyStatus,
  SourceTeam as PrismaSourceTeam
} from "@prisma/client";
import type {
  ArchiveStatus,
  CreateOperationInput,
  EducationFormat,
  OnsiteRequired,
  OperationChannel,
  OperationSession,
  OperationStatus,
  OperationType,
  ResultReportStatus,
  SatisfactionSurveyStatus,
  SourceTeam,
  UpdateOperationInput
} from "./operationTypes";
import {
  buildOperationMonth,
  deriveArchiveStatus,
  deriveProfit,
  deriveSessionDurationDays,
  deriveSessionDurationType,
  formatProcessId,
  summarizeOperations
} from "./operationCalculations";
import type { OperationRepository } from "./operationRepository";
import { getPrismaClient } from "./prisma";
import { normalizeRoleAssigneeText } from "./roleAssignees";
import { PrismaTeamMemberRepository } from "./prismaTeamMemberRepository";
import type { TeamMemberRole, TeamMemberRoleRoster } from "./teamMemberRepository";

const OPERATION_STATUS: Record<string, OperationStatus> = {
  ASSIGNMENT_NEEDED: "배정필요",
  ASSIGNMENT_PLANNED: "배정예정",
  ACTIVE: "진행중",
  DONE: "완료",
  RETROSPECTIVE_DONE: "회고완료",
  ARCHIVE_NEEDED: "아카이빙필요"
};

const EDUCATION_FORMAT: Record<string, EducationFormat> = {
  OFFLINE: "오프라인",
  REMOTE: "비대면",
  BLENDED: "블렌디드",
  FLIPPED: "플립러닝",
  NEEDS_REVIEW: "검토필요"
};

const OPERATION_CHANNEL: Record<string, OperationChannel> = {
  ONSITE: "onsite",
  LIVE_ONLINE: "live_online",
  ONLINE_PLATFORM: "online_platform",
  BLENDED: "blended",
  NEEDS_REVIEW: "needs_review"
};

const OPERATION_TYPE: Record<string, OperationType> = {
  LECTURE: "특강",
  SHORT: "단기",
  MEDIUM: "중기",
  MID_TERM_LONG: "중장기",
  MID_LONG: "준장기",
  LONG: "장기",
  ANNUAL: "연간",
  ALWAYS_ON: "상시형",
  NEEDS_REVIEW: "검토필요"
};

const RESULT_REPORT_STATUS: Record<string, ResultReportStatus> = {
  YES: "유",
  NO: "무",
  NOT_REQUIRED: "불필요",
  NEEDS_REVIEW: "확인필요"
};

const SATISFACTION_SURVEY_STATUS: Record<string, SatisfactionSurveyStatus> = {
  NOT_REQUIRED: "불필요",
  NEEDS_REVIEW: "확인필요"
};

const SOURCE_TEAM: Record<PrismaSourceTeam, SourceTeam> = {
  TEAM_1: "1팀",
  TEAM_2: "2팀",
  UNKNOWN: "미분류"
};

const PRISMA_OPERATION_STATUS: Record<OperationStatus, PrismaOperationStatus> = {
  "배정필요": PrismaOperationStatus.ASSIGNMENT_NEEDED,
  "배정예정": PrismaOperationStatus.ASSIGNMENT_PLANNED,
  "진행중": PrismaOperationStatus.ACTIVE,
  "완료": PrismaOperationStatus.DONE,
  "회고완료": PrismaOperationStatus.RETROSPECTIVE_DONE,
  "아카이빙필요": PrismaOperationStatus.ARCHIVE_NEEDED
};

const PRISMA_ARCHIVE_STATUS: Record<ArchiveStatus, PrismaArchiveStatus> = {
  "아카이빙전": PrismaArchiveStatus.NOT_READY,
  "아카이빙필요": PrismaArchiveStatus.NEEDED,
  "완료": PrismaArchiveStatus.DONE
};

const PRISMA_RESULT_REPORT_STATUS: Record<ResultReportStatus, PrismaResultReportStatus> = {
  "유": PrismaResultReportStatus.YES,
  "무": PrismaResultReportStatus.NO,
  "불필요": PrismaResultReportStatus.NOT_REQUIRED,
  "확인필요": PrismaResultReportStatus.NEEDS_REVIEW
};

const PRISMA_SATISFACTION_SURVEY_STATUS: Record<SatisfactionSurveyStatus, PrismaSatisfactionSurveyStatus> = {
  "불필요": PrismaSatisfactionSurveyStatus.NOT_REQUIRED,
  "확인필요": PrismaSatisfactionSurveyStatus.NEEDS_REVIEW
};

const PRISMA_EDUCATION_FORMAT: Record<EducationFormat, PrismaEducationFormat> = {
  "오프라인": PrismaEducationFormat.OFFLINE,
  "비대면": PrismaEducationFormat.REMOTE,
  "블렌디드": PrismaEducationFormat.BLENDED,
  "플립러닝": PrismaEducationFormat.FLIPPED,
  "검토필요": PrismaEducationFormat.NEEDS_REVIEW
};

const PRISMA_OPERATION_TYPE: Record<OperationType, PrismaOperationType> = {
  "특강": PrismaOperationType.LECTURE,
  "단기": PrismaOperationType.SHORT,
  "중기": PrismaOperationType.MEDIUM,
  "중장기": PrismaOperationType.MID_TERM_LONG,
  "준장기": PrismaOperationType.MID_LONG,
  "장기": PrismaOperationType.LONG,
  "연간": PrismaOperationType.ANNUAL,
  "상시형": PrismaOperationType.ALWAYS_ON,
  "검토필요": PrismaOperationType.NEEDS_REVIEW
};

export class PrismaOperationRepository implements OperationRepository {
  async listOperations(): Promise<OperationSession[]> {
    const prisma = getPrismaClient();
    const sessions = await prisma.operationSession.findMany({
      where: { deletedAt: null },
      include: {
        course: {
          include: {
            company: true
          }
        },
        sourceRecords: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: [{ startDate: "asc" }, { operationId: "asc" }]
    });

    return sessions.map((session) => {
      const revenue = decimalToNumber(session.course.revenue);
      const totalCost = decimalToNumber(session.totalCost);

      return {
        id: session.id,
        operationId: session.operationId,
        sourceTeam: session.sourceRecords[0]?.sourceTeam ? SOURCE_TEAM[session.sourceRecords[0].sourceTeam] : "미분류",
        processId: formatProcessId(session.course.processSeq),
        courseRecordId: session.course.id,
        courseId: session.course.courseId,
        companyName: session.course.company.name,
        courseName: session.course.name,
        courseCategory: session.course.courseCategory ?? "",
        tools: session.course.tools ?? "",
        om: session.omName ?? "",
        ld: session.ldName ?? "",
        onsiteOm: session.onsiteOmName ?? "",
        operationStatus: OPERATION_STATUS[session.operationStatus],
        archiveStatus: deriveArchiveStatus(toDateString(session.endDate), {
          courseId: session.course.courseId ?? "",
          lectureManagementNote: session.lectureManagementNote ?? "",
          avgSatisfaction: session.avgSatisfaction ?? "",
          hasResultReport: RESULT_REPORT_STATUS[session.hasResultReport],
          resultReportLink: session.resultReportLink ?? ""
        }),
        educationFormat: EDUCATION_FORMAT[session.educationFormat],
        educationFormatRaw: session.educationFormatRaw ?? "",
        operationChannel: OPERATION_CHANNEL[session.operationChannel],
        operationType: OPERATION_TYPE[session.course.operationType],
        operationTypeRaw: OPERATION_TYPE[session.course.operationType],
        roundNo: session.roundNo ?? "",
        educationDays: session.educationDays ?? "",
        startDate: toDateString(session.startDate),
        endDate: toDateString(session.endDate),
        operationMonth: session.operationMonth ?? "",
        sessionDurationDays: session.sessionDurationDays,
        sessionDurationType: session.sessionDurationType ? OPERATION_TYPE[session.sessionDurationType] : "검토필요",
        timeText: session.timeText ?? "",
        instructors: session.instructorsText ?? "",
        coach: session.coachText ?? "",
        region: session.region ?? "",
        onsiteRequired: session.onsiteRequired as OnsiteRequired,
        onsiteText: session.onsiteText ?? "",
        specialNotes: session.specialNotes ?? "",
        operationIssue: session.operationIssue ?? "",
        omUpdate: session.omUpdate ?? "",
        driveLink: session.driveLink ?? "",
        operationDetail: session.operationDetail ?? "",
        companyWikiLink: session.companyWikiLink ?? "",
        instructorWikiLink: session.instructorWikiLink ?? "",
        revenue,
        costRaw: session.costRaw ?? "",
        profitRaw: session.profitRaw ?? "",
        totalCost,
        instructorCost: decimalToNumber(session.instructorCost),
        operationCost: decimalToNumber(session.operationCost),
        profit: deriveProfit(revenue, totalCost),
        avgSatisfaction: session.avgSatisfaction ?? "",
        instructorSatisfaction: session.instructorSatisfaction ?? "",
        hasSatisfactionSurvey: SATISFACTION_SURVEY_STATUS[session.hasSatisfactionSurvey],
        hasResultReport: RESULT_REPORT_STATUS[session.hasResultReport],
        resultReportLink: session.resultReportLink ?? "",
        lectureManagementLink: session.lectureManagementLink ?? "",
        lectureManagementNote: session.lectureManagementNote ?? "",
        padletLink: session.padletLink ?? "",
        validationStatus: getValidationErrors(session.validationErrors).length > 0 ? "검토필요" : "정상",
        validationErrors: getValidationErrors(session.validationErrors)
      };
    });
  }

  async getOperationById(operationId: string): Promise<OperationSession | null> {
    const operations = await this.listOperations();
    return operations.find((operation) => operation.operationId === operationId) ?? null;
  }

  async createOperation(input: CreateOperationInput): Promise<OperationSession> {
    const prisma = getPrismaClient();
    const roleRoster = await new PrismaTeamMemberRepository().listRoleRosters();
    const companyName = normalizeVisibleText(input.companyName);
    const courseName = normalizeVisibleText(input.courseName);
    const courseId = normalizeVisibleText(input.courseId);
    const startDate = parseDateInput(input.startDate, "startDate");
    const endDate = parseDateInput(input.endDate, "endDate");

    if (!companyName) {
      throw new Error("Company name is required.");
    }

    if (!courseName) {
      throw new Error("Course name is required.");
    }

    if (startDate.getTime() > endDate.getTime()) {
      throw new Error("End date must be on or after start date.");
    }

    const operationId = `manual-${randomUUID()}`;
    const durationDays = dateDiffDays(startDate, endDate) + 1;
    const operationType = PRISMA_OPERATION_TYPE[input.operationType];
    const educationFormat = PRISMA_EDUCATION_FORMAT[input.educationFormat];

    const session = await prisma.$transaction(async (tx) => {
      const company = await tx.company.upsert({
        where: { normalizedName: normalizeName(companyName) },
        update: { name: companyName },
        create: {
          name: companyName,
          normalizedName: normalizeName(companyName)
        }
      });

      const course = await tx.course.upsert({
        where: {
          companyId_courseId_name: {
            companyId: company.id,
            courseId,
            name: courseName
          }
        },
        update: {
          operationType,
          revenue: input.revenue,
          revenueRaw: input.revenue === null ? null : String(input.revenue),
          ...(input.courseCategory !== undefined
            ? { courseCategory: normalizeVisibleText(input.courseCategory) || null }
            : {}),
          ...(input.tools !== undefined ? { tools: normalizeVisibleText(input.tools) || null } : {})
        },
        create: {
          companyId: company.id,
          courseId,
          name: courseName,
          operationType,
          revenue: input.revenue,
          revenueRaw: input.revenue === null ? null : String(input.revenue),
          courseCategory: input.courseCategory ? normalizeVisibleText(input.courseCategory) || null : null,
          tools: input.tools ? normalizeVisibleText(input.tools) || null : null
        }
      });

      return tx.operationSession.create({
        data: {
          archiveStatus: PRISMA_ARCHIVE_STATUS[input.archiveStatus],
          coachText: normalizeVisibleText(input.coach) || null,
          companyWikiLink: normalizeVisibleText(input.companyWikiLink) || null,
          costRaw: normalizeVisibleText(input.costRaw) || null,
          courseRecordId: course.id,
          createdBy: input.createdBy ?? null,
          driveLink: normalizeVisibleText(input.driveLink) || null,
          educationDays: normalizeVisibleText(input.educationDays) || null,
          educationFormat,
          educationFormatRaw: input.educationFormat,
          endDate,
          hasResultReport: PrismaResultReportStatus.NEEDS_REVIEW,
          hasSatisfactionSurvey: PrismaSatisfactionSurveyStatus.NEEDS_REVIEW,
          instructorCost: input.instructorCost,
          instructorWikiLink: normalizeVisibleText(input.instructorWikiLink) || null,
          instructorsText: normalizeVisibleText(input.instructors) || null,
          ldName: resolveAssigneeText(input.ld, "ld", roleRoster) || null,
          lectureManagementLink: normalizeVisibleText(input.lectureManagementLink) || null,
          omName: resolveAssigneeText(input.om, "om", roleRoster) || null,
          onsiteRequired: input.onsiteRequired as PrismaOnsiteRequired,
          onsiteText: onsiteRequiredLabel(input.onsiteRequired),
          operationChannel: PrismaOperationChannel.NEEDS_REVIEW,
          operationCost: input.operationCost,
          operationDetail: normalizeVisibleText(input.operationDetail) || null,
          operationId,
          operationIssue: normalizeVisibleText(input.operationIssue) || null,
          operationMonth: formatOperationMonth(startDate),
          operationStatus: PRISMA_OPERATION_STATUS[input.operationStatus],
          padletLink: normalizeVisibleText(input.padletLink) || null,
          region: normalizeVisibleText(input.region) || null,
          resultReportLink: normalizeVisibleText(input.resultReportLink) || null,
          roundNo: normalizeVisibleText(input.roundNo) || null,
          sessionDurationDays: durationDays,
          sessionDurationType: operationType,
          specialNotes: normalizeVisibleText(input.specialNotes) || null,
          startDate,
          timeText: normalizeVisibleText(input.timeText) || null,
          totalCost: input.totalCost,
          updatedBy: input.createdBy ?? null
        }
      });
    });

    const operation = await this.getOperationById(session.operationId);

    if (!operation) {
      throw new Error("Created operation could not be loaded.");
    }

    return operation;
  }

  async updateOperation(operationId: string, input: UpdateOperationInput): Promise<OperationSession> {
    const prisma = getPrismaClient();
    const data: Parameters<typeof prisma.operationSession.update>[0]["data"] = {};

    if (input.archiveStatus !== undefined) data.archiveStatus = PRISMA_ARCHIVE_STATUS[input.archiveStatus];
    if (input.avgSatisfaction !== undefined) data.avgSatisfaction = nullableText(input.avgSatisfaction);
    if (input.coach !== undefined) data.coachText = nullableText(input.coach);
    if (input.companyWikiLink !== undefined) data.companyWikiLink = nullableText(input.companyWikiLink);
    if (input.costRaw !== undefined) data.costRaw = nullableText(input.costRaw);

    if (input.courseId !== undefined) {
      const nextCourseId = normalizeVisibleText(input.courseId);

      if (!nextCourseId) {
        throw new Error("Course ID is required.");
      }

      const session = await prisma.operationSession.findUnique({
        include: { course: true },
        where: { operationId }
      });

      if (!session) {
        throw new Error("Operation not found.");
      }

      const course = await prisma.course.upsert({
        create: {
          companyId: session.course.companyId,
          courseId: nextCourseId,
          name: session.course.name,
          operationType: session.course.operationType,
          revenue: session.course.revenue,
          revenueRaw: session.course.revenueRaw
        },
        update: {},
        where: {
          companyId_courseId_name: {
            companyId: session.course.companyId,
            courseId: nextCourseId,
            name: session.course.name
          }
        }
      });

      data.courseRecordId = course.id;
    }

    if (input.courseName !== undefined) {
      const nextCourseName = normalizeVisibleText(input.courseName);

      if (!nextCourseName) {
        throw new Error("Course name is required.");
      }

      const session = await prisma.operationSession.findUnique({
        include: { course: true },
        where: { operationId }
      });

      if (!session) {
        throw new Error("Operation not found.");
      }

      const course = await prisma.course.upsert({
        create: {
          companyId: session.course.companyId,
          courseId: session.course.courseId,
          name: nextCourseName,
          operationType: session.course.operationType,
          revenue: session.course.revenue,
          revenueRaw: session.course.revenueRaw
        },
        update: {},
        where: {
          companyId_courseId_name: {
            companyId: session.course.companyId,
            courseId: session.course.courseId,
            name: nextCourseName
          }
        }
      });

      data.courseRecordId = course.id;
    }

    if (input.courseCategory !== undefined || input.tools !== undefined) {
      const session = await prisma.operationSession.findUnique({
        select: { courseRecordId: true },
        where: { operationId }
      });

      if (!session) {
        throw new Error("Operation not found.");
      }

      await prisma.course.update({
        data: {
          ...(input.courseCategory !== undefined ? { courseCategory: nullableText(input.courseCategory) } : {}),
          ...(input.tools !== undefined ? { tools: nullableText(input.tools) } : {})
        },
        where: { id: session.courseRecordId }
      });
    }

    if (input.driveLink !== undefined) data.driveLink = nullableText(input.driveLink);
    if (input.educationDays !== undefined) data.educationDays = nullableText(input.educationDays);
    if (input.hasResultReport !== undefined) data.hasResultReport = PRISMA_RESULT_REPORT_STATUS[input.hasResultReport];
    if (input.hasSatisfactionSurvey !== undefined) {
      data.hasSatisfactionSurvey = PRISMA_SATISFACTION_SURVEY_STATUS[input.hasSatisfactionSurvey];
    }

    if (input.startDate !== undefined || input.endDate !== undefined) {
      const current = await this.getOperationById(operationId);

      if (!current) {
        throw new Error("Operation not found.");
      }

      const nextStartDate = input.startDate ?? current.startDate;
      const nextEndDate = input.endDate ?? current.endDate;
      const sessionDurationDays = deriveSessionDurationDays(nextStartDate, nextEndDate);

      data.startDate = parseDateInput(nextStartDate, "startDate");
      data.endDate = parseDateInput(nextEndDate, "endDate");
      data.operationMonth = buildOperationMonth(nextStartDate);
      data.sessionDurationDays = sessionDurationDays;
      data.sessionDurationType = PRISMA_OPERATION_TYPE[deriveSessionDurationType(sessionDurationDays)];
    }

    if (input.instructorCost !== undefined) data.instructorCost = input.instructorCost;
    if (input.instructorSatisfaction !== undefined) data.instructorSatisfaction = nullableText(input.instructorSatisfaction);
    if (input.instructors !== undefined) data.instructorsText = nullableText(input.instructors);
    if (input.instructorWikiLink !== undefined) data.instructorWikiLink = nullableText(input.instructorWikiLink);
    if (input.ld !== undefined) data.ldName = nullableText(input.ld);
    if (input.lectureManagementLink !== undefined) data.lectureManagementLink = nullableText(input.lectureManagementLink);
    if (input.lectureManagementNote !== undefined) data.lectureManagementNote = nullableText(input.lectureManagementNote);
    if (input.om !== undefined) data.omName = nullableText(input.om);
    if (input.onsiteOm !== undefined) data.onsiteOmName = nullableText(input.onsiteOm);
    if (input.operationCost !== undefined) data.operationCost = input.operationCost;
    if (input.operationDetail !== undefined) data.operationDetail = nullableText(input.operationDetail);
    if (input.operationIssue !== undefined) data.operationIssue = nullableText(input.operationIssue);
    if (input.operationStatus !== undefined) data.operationStatus = PRISMA_OPERATION_STATUS[input.operationStatus];
    if (input.omUpdate !== undefined) data.omUpdate = nullableText(input.omUpdate);
    if (input.padletLink !== undefined) data.padletLink = nullableText(input.padletLink);
    if (input.region !== undefined) data.region = nullableText(input.region);
    if (input.resultReportLink !== undefined) data.resultReportLink = nullableText(input.resultReportLink);
    if (input.specialNotes !== undefined) data.specialNotes = nullableText(input.specialNotes);
    if (input.timeText !== undefined) data.timeText = nullableText(input.timeText);
    if (input.totalCost !== undefined) data.totalCost = input.totalCost;

    if (Object.keys(data).length === 0) {
      const operation = await this.getOperationById(operationId);

      if (!operation) {
        throw new Error("Operation not found.");
      }

      return operation;
    }

    await prisma.operationSession.update({
      where: { operationId },
      data
    });

    const operation = await this.getOperationById(operationId);

    if (!operation) {
      throw new Error("Updated operation could not be loaded.");
    }

    return operation;
  }

  async deleteOperation(operationId: string, deletedBy?: string): Promise<void> {
    const prisma = getPrismaClient();

    await prisma.operationSession.update({
      where: { operationId },
      data: { deletedAt: new Date(), deletedBy: deletedBy ?? null }
    });
  }

  async getSummary() {
    return summarizeOperations(await this.listOperations());
  }
}

function decimalToNumber(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getValidationErrors(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeVisibleText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function nullableText(value: string): string | null {
  return normalizeVisibleText(value) || null;
}

function normalizeName(value: string): string {
  return normalizeVisibleText(value).toLowerCase();
}

function resolveAssigneeText(value: string, role: TeamMemberRole, roleRoster: TeamMemberRoleRoster): string {
  const rawText = normalizeVisibleText(value);
  if (!rawText) return "";

  const matchedText = normalizeRoleAssigneeText(rawText, role, roleRoster);
  return matchedText || rawText;
}

function parseDateInput(value: string, fieldName: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new Error(`${fieldName} must be a valid date.`);
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`${fieldName} must be a valid date.`);
  }

  return date;
}

function dateDiffDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function formatOperationMonth(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function onsiteRequiredLabel(value: OnsiteRequired): string | null {
  if (value === "Y") return "오프라인";
  if (value === "N") return "온라인";
  if (value === "PARTIAL") return "일부 오프라인";
  return null;
}
