import { randomUUID } from "node:crypto";
import {
  ArchiveStatus,
  EducationFormat,
  OnsiteRequired,
  OperationChannel,
  OperationStatus,
  OperationType,
  ResultReportStatus,
  type Prisma,
  type SourceTeam
} from "@prisma/client";
import { getPrismaClient } from "./prisma";
import { PrismaTeamMemberRepository } from "./prismaTeamMemberRepository";
import { normalizeRoleAssigneeText } from "./roleAssignees";
import type { TeamMemberRole, TeamMemberRoleRoster } from "./teamMemberRepository";

interface PromotionCandidate {
  blockedReason: string | null;
  companyName: string;
  courseName: string;
  endDate: Date | null;
  fields: Record<string, string>;
  startDate: Date | null;
}

export interface ImportPromotionResult {
  blocked: number;
  blockedReasons: Record<string, number>;
  created: number;
  eligible: number;
  linkedExisting: number;
  sourceRows: number;
}

const OPERATION_STATUS_BY_TEXT: Record<string, OperationStatus> = {
  "배정필요": OperationStatus.ASSIGNMENT_NEEDED,
  "배정예정": OperationStatus.ASSIGNMENT_PLANNED,
  "배정 예정": OperationStatus.ASSIGNMENT_PLANNED,
  "진행중": OperationStatus.ACTIVE,
  "진행 중": OperationStatus.ACTIVE,
  "완료": OperationStatus.DONE,
  "회고완료": OperationStatus.RETROSPECTIVE_DONE,
  "회고 완료": OperationStatus.RETROSPECTIVE_DONE,
  "아카이빙필요": OperationStatus.ARCHIVE_NEEDED,
  "아카이빙 필요": OperationStatus.ARCHIVE_NEEDED
};

const ARCHIVE_STATUS_BY_TEXT: Record<string, ArchiveStatus> = {
  "아카이빙전": ArchiveStatus.NOT_READY,
  "아카이빙 전": ArchiveStatus.NOT_READY,
  "아카이빙필요": ArchiveStatus.NEEDED,
  "아카이빙 필요": ArchiveStatus.NEEDED,
  "완료": ArchiveStatus.DONE
};

const EDUCATION_FORMAT_BY_TEXT: Record<string, EducationFormat> = {
  "오프라인": EducationFormat.OFFLINE,
  "비대면": EducationFormat.REMOTE,
  "온라인": EducationFormat.REMOTE,
  "블렌디드": EducationFormat.BLENDED,
  "블랜디드": EducationFormat.BLENDED,
  "플립러닝": EducationFormat.FLIPPED,
  "검토필요": EducationFormat.NEEDS_REVIEW
};

const OPERATION_TYPE_BY_TEXT: Record<string, OperationType> = {
  "특강": OperationType.LECTURE,
  "단기": OperationType.SHORT,
  "중기": OperationType.MEDIUM,
  "중장기": OperationType.MID_TERM_LONG,
  "준장기": OperationType.MID_LONG,
  "장기": OperationType.LONG,
  "연간": OperationType.ANNUAL,
  "상시형": OperationType.ALWAYS_ON,
  "검토필요": OperationType.NEEDS_REVIEW
};

const RESULT_REPORT_STATUS_BY_TEXT: Record<string, ResultReportStatus> = {
  "유": ResultReportStatus.YES,
  "무": ResultReportStatus.NO,
  "불필요": ResultReportStatus.NOT_REQUIRED,
  "확인필요": ResultReportStatus.NEEDS_REVIEW,
  "검토필요": ResultReportStatus.NEEDS_REVIEW
};

const ONSITE_REQUIRED_BY_TEXT: Record<string, OnsiteRequired> = {
  "y": OnsiteRequired.Y,
  "n": OnsiteRequired.N,
  "일부": OnsiteRequired.PARTIAL,
  "일부필요": OnsiteRequired.PARTIAL
};

export async function promoteReadyImportRows(importRunId: string): Promise<ImportPromotionResult> {
  const prisma = getPrismaClient();
  const roleRoster = await new PrismaTeamMemberRepository().listRoleRosters();

  return prisma.$transaction(async (tx) => {
    const importRun = await tx.dataImportRun.findUnique({
      where: { id: importRunId },
      select: { sourceType: true }
    });

    if (importRun?.sourceType.toLowerCase().includes("notion")) {
      throw new Error("Notion 가져오기는 검수용으로만 저장합니다. 중복 방지를 위해 운영 데이터 반영은 막혀 있습니다.");
    }

    const sourceRecords = await tx.operationSourceRecord.findMany({
      where: {
        importRunId,
        operationSessionId: null
      },
      orderBy: [{ sourceSheet: "asc" }, { sourceRowNumber: "asc" }]
    });
    const summary: ImportPromotionResult = {
      blocked: 0,
      blockedReasons: {},
      created: 0,
      eligible: 0,
      linkedExisting: 0,
      sourceRows: sourceRecords.length
    };

    for (const sourceRecord of sourceRecords) {
      const candidate = buildPromotionCandidate(sourceRecord.mappedFields, sourceRecord.validationErrors);

      if (candidate.blockedReason || !candidate.startDate || !candidate.endDate) {
        addBlocked(summary, candidate.blockedReason ?? "날짜 해석 실패");
        continue;
      }

      summary.eligible += 1;

      const existingByFingerprint = await findExistingSessionByFingerprint(tx, sourceRecord.sourceFingerprint);
      if (existingByFingerprint) {
        await linkSourceRecord(tx, sourceRecord.id, existingByFingerprint.id);
        summary.linkedExisting += 1;
        continue;
      }

      const existingByBusinessKey = await findExistingSessionByBusinessKey(tx, {
        companyName: candidate.companyName,
        courseName: candidate.courseName,
        endDate: candidate.endDate,
        startDate: candidate.startDate
      });

      if (existingByBusinessKey) {
        await linkSourceRecord(tx, sourceRecord.id, existingByBusinessKey.id);
        summary.linkedExisting += 1;
        continue;
      }

      const company = await tx.company.upsert({
        where: { normalizedName: normalizeName(candidate.companyName) },
        update: { name: candidate.companyName },
        create: {
          name: candidate.companyName,
          normalizedName: normalizeName(candidate.companyName)
        }
      });
      const course = await tx.course.upsert({
        where: {
          companyId_courseId_name: {
            companyId: company.id,
            courseId: normalizeVisibleText(candidate.fields.courseId),
            name: candidate.courseName
          }
        },
        update: {
          operationType: enumFromText(OPERATION_TYPE_BY_TEXT, candidate.fields.operationType, OperationType.NEEDS_REVIEW),
          revenue: nullableNumber(candidate.fields.revenue),
          revenueRaw: nullableText(candidate.fields.revenueRaw)
        },
        create: {
          companyId: company.id,
          courseId: normalizeVisibleText(candidate.fields.courseId),
          name: candidate.courseName,
          operationType: enumFromText(OPERATION_TYPE_BY_TEXT, candidate.fields.operationType, OperationType.NEEDS_REVIEW),
          revenue: nullableNumber(candidate.fields.revenue),
          revenueRaw: nullableText(candidate.fields.revenueRaw)
        }
      });
      const session = await tx.operationSession.create({
        data: buildOperationSessionCreateData({
          courseRecordId: course.id,
          endDate: candidate.endDate,
          fields: candidate.fields,
          roleRoster,
          sourceFingerprint: sourceRecord.sourceFingerprint,
          sourceTeam: sourceRecord.sourceTeam,
          startDate: candidate.startDate
        }),
        select: { id: true }
      });

      await linkSourceRecord(tx, sourceRecord.id, session.id);
      summary.created += 1;
    }

    return summary;
  });
}

function buildPromotionCandidate(mappedFields: Prisma.JsonValue | null, validationErrors: Prisma.JsonValue | null): PromotionCandidate {
  const fields = jsonObjectToStringRecord(mappedFields);
  const errors = jsonStringArray(validationErrors);
  const companyName = normalizeVisibleText(fields.companyName);
  const courseName = normalizeVisibleText(fields.courseName);
  const startDate = parseDateValue(fields.startDate);
  const endDate = parseDateValue(fields.endDate);

  if (errors.length > 0) {
    return { blockedReason: errors.join(" / "), companyName, courseName, endDate, fields, startDate };
  }

  if (!fields.om?.trim()) {
    return { blockedReason: "담당OM 정보가 없습니다.", companyName, courseName, endDate, fields, startDate };
  }

  if (!fields.ld?.trim()) {
    return { blockedReason: "담당LD 정보가 없습니다.", companyName, courseName, endDate, fields, startDate };
  }

  if (!companyName) {
    return { blockedReason: "기업명 누락", companyName, courseName, endDate, fields, startDate };
  }

  if (!courseName) {
    return { blockedReason: "과정명 누락", companyName, courseName, endDate, fields, startDate };
  }

  if (!startDate) {
    return { blockedReason: "시작일 누락 또는 날짜 해석 실패", companyName, courseName, endDate, fields, startDate };
  }

  if (!endDate) {
    return { blockedReason: "종료일 누락 또는 날짜 해석 실패", companyName, courseName, endDate, fields, startDate };
  }

  if (startDate.getTime() > endDate.getTime()) {
    return { blockedReason: "종료일이 시작일보다 빠름", companyName, courseName, endDate, fields, startDate };
  }

  return { blockedReason: null, companyName, courseName, endDate, fields, startDate };
}

async function findExistingSessionByFingerprint(tx: Prisma.TransactionClient, sourceFingerprint: string | null) {
  if (!sourceFingerprint) return null;

  return tx.operationSession.findFirst({
    where: {
      deletedAt: null,
      sourceFingerprint
    },
    select: { id: true }
  });
}

async function findExistingSessionByBusinessKey(
  tx: Prisma.TransactionClient,
  input: {
    companyName: string;
    courseName: string;
    endDate: Date;
    startDate: Date;
  }
) {
  return tx.operationSession.findFirst({
    where: {
      deletedAt: null,
      endDate: input.endDate,
      startDate: input.startDate,
      course: {
        name: input.courseName,
        company: {
          normalizedName: normalizeName(input.companyName)
        }
      }
    },
    select: { id: true }
  });
}

async function linkSourceRecord(tx: Prisma.TransactionClient, sourceRecordId: string, operationSessionId: string) {
  await tx.operationSourceRecord.update({
    where: { id: sourceRecordId },
    data: { operationSessionId }
  });
}

function buildOperationSessionCreateData(input: {
  courseRecordId: string;
  endDate: Date;
  fields: Record<string, string>;
  roleRoster: TeamMemberRoleRoster;
  sourceFingerprint: string | null;
  sourceTeam: SourceTeam;
  startDate: Date;
}): Prisma.OperationSessionCreateInput {
  const durationDays = dateDiffDays(input.startDate, input.endDate);

  return {
    archiveStatus: enumFromText(ARCHIVE_STATUS_BY_TEXT, input.fields.archiveStatus, ArchiveStatus.NOT_READY),
    coachText: nullableText(input.fields.coach),
    companyWikiLink: nullableText(input.fields.companyWikiLink),
    costRaw: nullableText(input.fields.costRaw),
    course: { connect: { id: input.courseRecordId } },
    driveLink: nullableText(input.fields.driveLink),
    educationDays: nullableText(input.fields.educationDays),
    educationFormat: enumFromText(EDUCATION_FORMAT_BY_TEXT, input.fields.educationFormat, EducationFormat.NEEDS_REVIEW),
    educationFormatRaw: nullableText(input.fields.educationFormat),
    endDate: input.endDate,
    hasResultReport: enumFromText(
      RESULT_REPORT_STATUS_BY_TEXT,
      input.fields.hasResultReport,
      ResultReportStatus.NEEDS_REVIEW
    ),
    instructorCost: nullableNumber(input.fields.instructorCost),
    instructorSatisfaction: nullableText(input.fields.instructorSatisfaction),
    instructorWikiLink: nullableText(input.fields.instructorWikiLink),
    instructorsText: nullableText(input.fields.instructors),
    ldName: nullableText(resolveAssigneeText(input.fields.ld, "ld", input.roleRoster)),
    lectureManagementLink: nullableText(input.fields.lectureManagementLink),
    omName: nullableText(resolveAssigneeText(input.fields.om, "om", input.roleRoster)),
    omUpdate: nullableText(input.fields.omUpdate),
    onsiteRequired: enumFromText(ONSITE_REQUIRED_BY_TEXT, input.fields.onsiteText, OnsiteRequired.UNKNOWN),
    onsiteText: nullableText(input.fields.onsiteText),
    operationChannel: enumFromText(
      {
        blended: OperationChannel.BLENDED,
        live_online: OperationChannel.LIVE_ONLINE,
        needs_review: OperationChannel.NEEDS_REVIEW,
        online_platform: OperationChannel.ONLINE_PLATFORM,
        onsite: OperationChannel.ONSITE
      },
      input.fields.operationChannel,
      OperationChannel.NEEDS_REVIEW
    ),
    operationCost: nullableNumber(input.fields.operationCost),
    operationDetail: nullableText(input.fields.operationDetail),
    operationId: stableOperationId(input.sourceTeam, input.sourceFingerprint),
    operationIssue: nullableText(input.fields.operationIssue),
    operationMonth: formatOperationMonth(input.startDate),
    operationStatus: enumFromText(OPERATION_STATUS_BY_TEXT, input.fields.operationStatus, OperationStatus.ASSIGNMENT_NEEDED),
    padletLink: nullableText(input.fields.padletLink),
    profitRaw: nullableText(input.fields.profitRaw),
    region: nullableText(input.fields.region),
    resultReportLink: nullableText(input.fields.resultReportLink),
    roundNo: nullableText(input.fields.roundNo),
    sessionDurationDays: nullableInteger(input.fields.sessionDurationDays) ?? durationDays,
    sessionDurationType: enumFromText(OPERATION_TYPE_BY_TEXT, input.fields.sessionDurationType, OperationType.NEEDS_REVIEW),
    sourceFingerprint: input.sourceFingerprint,
    specialNotes: nullableText(input.fields.specialNotes),
    startDate: input.startDate,
    timeText: nullableText(input.fields.timeText),
    totalCost: nullableNumber(input.fields.totalCost),
    validationErrors: []
  };
}

function addBlocked(summary: ImportPromotionResult, reason: string) {
  summary.blocked += 1;
  summary.blockedReasons[reason] = (summary.blockedReasons[reason] ?? 0) + 1;
}

function stableOperationId(sourceTeam: SourceTeam, sourceFingerprint: string | null) {
  const fingerprint = sourceFingerprint || randomUUID().replaceAll("-", "");
  return `SRC-${sourceTeam.replace("_", "").toUpperCase()}-${fingerprint.slice(0, 12).toUpperCase()}`;
}

function enumFromText<T>(map: Record<string, T>, value: string | undefined, fallback: T): T {
  const normalized = normalizeVisibleText(value);
  return map[normalized] ?? map[normalized.toLowerCase()] ?? fallback;
}

function jsonObjectToStringRecord(value: Prisma.JsonValue | null): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, fieldValue]) => [key, jsonValueToString(fieldValue)])
      .filter(([key, fieldValue]) => key && fieldValue)
  );
}

function jsonStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function jsonValueToString(value: Prisma.JsonValue | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function normalizeVisibleText(value: string | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function nullableText(value: string | undefined): string | null {
  const normalized = normalizeVisibleText(value);
  return normalized || null;
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

function parseDateValue(value: string | undefined): Date | null {
  const normalized = normalizeVisibleText(value).replace(/[./]/g, "-");
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);

  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }

  return date;
}

function formatOperationMonth(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nullableNumber(value: string | undefined): number | null {
  const normalized = normalizeVisibleText(value).replaceAll(",", "");
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableInteger(value: string | undefined): number | null {
  const parsed = nullableNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function dateDiffDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
