import type { Prisma } from "@prisma/client";
import { missingPromotionFields } from "./importPromotionFields";
import type {
  ImportRunDetail,
  ImportRunStatus,
  LinkedOperationPreview,
  SourceRecordFieldPreview,
  SourceRecordPreview,
  SourceRecordReviewStatus,
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
      fileName: run.fileName ?? run.sourceName ?? "",
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
          include: {
            operationSession: {
              include: {
                course: {
                  include: {
                    company: true
                  }
                }
              }
            }
          },
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
      fileName: run.fileName ?? run.sourceName ?? "",
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
  operationSession: {
    operationId: string;
    startDate: Date;
    endDate: Date;
    course: {
      name: string;
      company: {
        name: string;
      };
    };
  } | null;
  rowSnapshot: Prisma.JsonValue;
  mappedFields: Prisma.JsonValue | null;
  unmappedFields: Prisma.JsonValue | null;
  validationErrors: Prisma.JsonValue | null;
  createdAt: Date;
}): SourceRecordPreview {
  const mappedFields = getFieldPreview(record.mappedFields);
  const unmappedFields = getFieldPreview(record.unmappedFields);
  const validationErrors = getStringArray(record.validationErrors);
  const linkedOperation = toLinkedOperationPreview(record.operationSession);
  const mappedFieldObject = getStringRecord(record.mappedFields);

  return {
    id: record.id,
    sourceTeam: SOURCE_TEAM[record.sourceTeam],
    sourceRowNumber: record.sourceRowNumber,
    headerRowNumber: record.headerRowNumber,
    sourceFingerprint: record.sourceFingerprint ?? "",
    linkedOperationId: record.operationSessionId ?? "",
    linkedOperation,
    mappedFieldCount: mappedFields.length,
    mappedFields,
    unmappedFieldCount: unmappedFields.length,
    unmappedFields,
    rowSnapshotPreview: getFieldPreview(record.rowSnapshot).slice(0, 8),
    missingRequiredFields: missingPromotionFields(mappedFieldObject),
    reviewStatus: getReviewStatus({
      linkedOperation,
      mappedFields: mappedFieldObject,
      mappedFieldCount: mappedFields.length,
      validationErrors
    }),
    validationErrors,
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

function getStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getFieldPreview(value: Prisma.JsonValue | null): SourceRecordFieldPreview[] {
  if (!value || Array.isArray(value) || typeof value !== "object") return [];

  return Object.entries(value)
    .filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined && String(fieldValue).trim())
    .slice(0, 12)
    .map(([key, fieldValue]) => ({
      key,
      label: FIELD_LABELS[key] ?? key,
      value: stringifyFieldValue(fieldValue)
    }));
}

function getStringRecord(value: Prisma.JsonValue | null): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, fieldValue]) => [key, stringifyFieldValue(fieldValue).trim()])
      .filter(([key, fieldValue]) => key && fieldValue)
  );
}

function stringifyFieldValue(value: Prisma.JsonValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function toLinkedOperationPreview(
  operationSession: {
    operationId: string;
    startDate: Date;
    endDate: Date;
    course: {
      name: string;
      company: {
        name: string;
      };
    };
  } | null
): LinkedOperationPreview | null {
  if (!operationSession) return null;

  return {
    operationId: operationSession.operationId,
    companyName: operationSession.course.company.name,
    courseName: operationSession.course.name,
    dateRange: `${toDateString(operationSession.startDate)} - ${toDateString(operationSession.endDate)}`
  };
}

function toDateString(value: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeZone: "Asia/Seoul"
  }).format(value);
}

function getReviewStatus(input: {
  linkedOperation: LinkedOperationPreview | null;
  mappedFields: Record<string, string>;
  mappedFieldCount: number;
  validationErrors: string[];
}): SourceRecordReviewStatus {
  if (input.validationErrors.length > 0) return "확인 필요";
  if (input.mappedFieldCount === 0) return "확인 필요";
  if (hasPromotionRequiredFields(input.mappedFields)) return "적용 준비";
  if (!input.linkedOperation) return "매칭 필요";
  return "적용 준비";
}

/** 반영 필수 필드가 다 채워졌는가. 부족한 목록 계산과 같은 함수를 써서 어긋나지 않게 한다. */
function hasPromotionRequiredFields(fields: Record<string, string>) {
  return missingPromotionFields(fields).length === 0;
}

const FIELD_LABELS: Record<string, string> = {
  companyName: "기업명",
  courseId: "코스 ID",
  courseName: "과정명",
  endDate: "종료일",
  instructors: "강사",
  ld: "LD",
  om: "OM",
  operationId: "운영 ID",
  startDate: "시작일"
};
