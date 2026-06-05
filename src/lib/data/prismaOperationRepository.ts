import type {
  ArchiveStatus,
  EducationFormat,
  OnsiteRequired,
  OperationChannel,
  OperationSession,
  OperationStatus,
  OperationType,
  ResultReportStatus
} from "./operationTypes";
import { deriveProfit, summarizeOperations } from "./operationCalculations";
import type { OperationRepository } from "./operationRepository";
import { getPrismaClient } from "./prisma";

const OPERATION_STATUS: Record<string, OperationStatus> = {
  ASSIGNMENT_NEEDED: "배정필요",
  ASSIGNMENT_PLANNED: "배정예정",
  ACTIVE: "진행중",
  DONE: "완료",
  RETROSPECTIVE_DONE: "회고완료",
  ARCHIVE_NEEDED: "아카이빙필요"
};

const ARCHIVE_STATUS: Record<string, ArchiveStatus> = {
  NOT_READY: "아카이빙전",
  NEEDED: "아카이빙필요",
  DONE: "완료"
};

const EDUCATION_FORMAT: Record<string, EducationFormat> = {
  OFFLINE: "오프라인",
  REMOTE: "비대면",
  BLENDED: "블랜디드",
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
        courseId: session.course.courseId,
        companyName: session.course.company.name,
        courseName: session.course.name,
        om: session.omName ?? "",
        ld: session.ldName ?? "",
        operationStatus: OPERATION_STATUS[session.operationStatus],
        archiveStatus: ARCHIVE_STATUS[session.archiveStatus],
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
        hasResultReport: RESULT_REPORT_STATUS[session.hasResultReport],
        resultReportLink: session.resultReportLink ?? "",
        lectureManagementLink: session.lectureManagementLink ?? "",
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
