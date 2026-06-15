import type { Prisma } from "@prisma/client";
import type {
  ImportRunDetail,
  ImportRunStatus,
  SourceRecordPreview,
  SourceTeamLabel
} from "./importTypes";
import type { ImportRepository } from "./importRepository";
import { getPrismaClient } from "./prisma";

const IMPORT_STATUS: Record<string, ImportRunStatus> = {
  PENDING: "대기",
  COMPLETED: "완료",
  COMPLETED_WITH_ERRORS: "오류있음",
  FAILED: "실패"
};

const SOURCE_TEAM: Record<string, SourceTeamLabel> = {
  TEAM_1: "1팀",
  TEAM_2: "2팀",
  UNKNOWN: "미확인"
};

export class PrismaImportRepository implements ImportRepository {
  async listImportRuns() {
    const prisma = getPrismaClient();
    const runs = await prisma.dataImportRun.findMany({
      include: {
        _count: {
          select: {
            sourceRecords: true
          }
        }
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }]
    });

    return runs.map((run) => ({
      id: run.id,
      sourceTeam: SOURCE_TEAM[run.sourceTeam],
      sourceType: run.sourceType,
      status: IMPORT_STATUS[run.status],
      rowCount: run.rowCount,
      successCount: run.successCount,
      errorCount: run.errorCount,
      sourceRecordCount: run._count.sourceRecords,
      importedBy: run.importedBy ?? "",
      startedAt: toDateTimeString(run.startedAt),
      finishedAt: run.finishedAt ? toDateTimeString(run.finishedAt) : "",
      notes: run.notes ?? "",
      validationLogCount: countJsonItems(run.validationLogs)
    }));
  }

  async getImportRunById(id: string): Promise<ImportRunDetail | null> {
    const prisma = getPrismaClient();
    const run = await prisma.dataImportRun.findUnique({
      where: { id },
      include: {
        sourceRecords: {
          orderBy: [{ sourceSheet: "asc" }, { sourceRowNumber: "asc" }],
          take: 200
        },
        _count: {
          select: {
            sourceRecords: true
          }
        }
      }
    });

    if (!run) return null;

    return {
      id: run.id,
      sourceTeam: SOURCE_TEAM[run.sourceTeam],
      sourceType: run.sourceType,
      status: IMPORT_STATUS[run.status],
      rowCount: run.rowCount,
      successCount: run.successCount,
      errorCount: run.errorCount,
      sourceRecordCount: run._count.sourceRecords,
      importedBy: run.importedBy ?? "",
      startedAt: toDateTimeString(run.startedAt),
      finishedAt: run.finishedAt ? toDateTimeString(run.finishedAt) : "",
      notes: run.notes ?? "",
      validationLogCount: countJsonItems(run.validationLogs),
      records: run.sourceRecords.map(toSourceRecordPreview)
    };
  }
}

function toSourceRecordPreview(record: {
  id: string;
  sourceTeam: string;
  sourceRowNumber: number;
  headerRowNumber: number | null;
  sourceFingerprint: string | null;
  operationSessionId: string | null;
  mappedFields: Prisma.JsonValue | null;
  unmappedFields: Prisma.JsonValue | null;
  validationErrors: Prisma.JsonValue | null;
  createdAt: Date;
}): SourceRecordPreview {
  return {
    id: record.id,
    sourceTeam: SOURCE_TEAM[record.sourceTeam],
    sourceRowNumber: record.sourceRowNumber,
    headerRowNumber: record.headerRowNumber,
    sourceFingerprint: record.sourceFingerprint ?? "",
    linkedOperationId: record.operationSessionId ?? "",
    mappedFieldCount: countObjectKeys(record.mappedFields),
    unmappedFieldCount: countObjectKeys(record.unmappedFields),
    validationErrors: getStringArray(record.validationErrors),
    createdAt: toDateTimeString(record.createdAt)
  };
}

function toDateTimeString(value: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(value);
}

function countJsonItems(value: Prisma.JsonValue | null): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function countObjectKeys(value: Prisma.JsonValue | null): number {
  if (!value || Array.isArray(value) || typeof value !== "object") return 0;
  return Object.keys(value).length;
}

function getStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
