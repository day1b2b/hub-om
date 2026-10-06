import { getPrismaClient } from "./prisma";
import { DATABASE_TABLE_SAMPLE_LIMIT } from "../admin/databaseDashboardPresenter";

/** Preserve the original sixteen queries and their projections/order. */
export async function readPrismaAdminDatabaseRows() {
  const prisma = getPrismaClient();
  const [
    companyCount,
    companies,
    courseCount,
    courses,
    operationSessionCount,
    operationSessions,
    memberCount,
    members,
    dataImportRunCount,
    dataImportRuns,
    operationSourceRecordCount,
    operationSourceRecords,
    driveImportRunCount,
    driveImportRuns,
    driveImportResultCount,
    driveImportResults
  ] = await Promise.all([
    prisma.company.count(),
    prisma.company.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        courses: { select: { id: true }, take: 1 },
        createdAt: true,
        updatedAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.course.count(),
    prisma.course.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        processSeq: true,
        courseId: true,
        name: true,
        operationType: true,
        revenue: true,
        company: { select: { name: true } },
        sessions: { select: { id: true }, take: 1 },
        createdAt: true,
        updatedAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.operationSession.count(),
    prisma.operationSession.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        operationId: true,
        operationStatus: true,
        archiveStatus: true,
        educationFormat: true,
        operationChannel: true,
        roundNo: true,
        educationDays: true,
        startDate: true,
        endDate: true,
        timeText: true,
        omName: true,
        ldName: true,
        instructorsText: true,
        coachText: true,
        region: true,
        onsiteRequired: true,
        onsiteOmName: true,
        specialNotes: true,
        operationIssue: true,
        omUpdate: true,
        driveLink: true,
        operationDetail: true,
        companyWikiLink: true,
        instructorWikiLink: true,
        costRaw: true,
        totalCost: true,
        instructorCost: true,
        operationCost: true,
        avgSatisfaction: true,
        instructorSatisfaction: true,
        hasResultReport: true,
        resultReportLink: true,
        lectureManagementLink: true,
        padletLink: true,
        deletedAt: true,
        updatedAt: true,
        course: {
          select: {
            name: true,
            company: { select: { name: true } }
          }
        }
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.member.count(),
    prisma.member.findMany({
      orderBy: [{ isActive: "desc" }, { displayOrder: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        role: true,
        sourceTeam: true,
        name: true,
        roleTitle: true,
        isActive: true,
        calendarId: true,
        displayOrder: true,
        updatedAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.dataImportRun.count(),
    prisma.dataImportRun.findMany({
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        sourceTeam: true,
        sourceType: true,
        sourceName: true,
        workbookName: true,
        fileName: true,
        status: true,
        rowCount: true,
        successCount: true,
        errorCount: true,
        startedAt: true,
        finishedAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.operationSourceRecord.count(),
    prisma.operationSourceRecord.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        sourceTeam: true,
        sourceWorkbook: true,
        sourceSheet: true,
        sourceRowNumber: true,
        sourceFingerprint: true,
        rowSnapshot: true,
        mappedFields: true,
        validationErrors: true,
        createdAt: true,
        operationSession: { select: { operationId: true } }
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.driveImportRun.count(),
    prisma.driveImportRun.findMany({
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        mode: true,
        status: true,
        operationCount: true,
        scannedRefCount: true,
        folderSearchCount: true,
        errorCount: true,
        startedAt: true,
        finishedAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.driveImportResult.count(),
    prisma.driveImportResult.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        operationId: true,
        companyName: true,
        courseName: true,
        inputKind: true,
        resultKind: true,
        candidateCount: true,
        fileCount: true,
        issues: true,
        error: true,
        createdAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    })
  ]);

  return {
companyCount,
    companies,
    courseCount,
    courses,
    operationSessionCount,
    operationSessions,
    memberCount,
    members,
    dataImportRunCount,
    dataImportRuns,
    operationSourceRecordCount,
    operationSourceRecords,
    driveImportRunCount,
    driveImportRuns,
    driveImportResultCount,
    driveImportResults
  };
}
