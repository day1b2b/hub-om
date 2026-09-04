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
  /**
   * 전에 반영했다가 삭제된 운영을 같은 원천 행으로 되살린 건수.
   *
   * operationId가 원천 행 지문에서 결정적으로 만들어지고(stableOperationId) operation_id는
   * @unique다. 그래서 지문이 같은 행을 다시 반영하면 같은 operationId가 나온다.
   * 삭제된 운영은 행이 남아 있어(soft delete) 유니크 제약도 살아 있는데, 중복 검사가
   * deletedAt: null만 보고 있어서 "없다"고 판단하고 만들려다 DB에 막혔다.
   */
  revived: number;
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
      revived: 0,
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
        if (existingByFingerprint.deletedAt) {
          // 전에 반영했다가 삭제한 운영을 같은 원천 행으로 다시 올렸다. 되살린다.
          // 새로 만들 수는 없다 — operationId가 지문에서 결정적으로 나오고 @unique라
          // 유니크 충돌이 나면서 반영 전체가 실패한다.
          // 원천 행을 고쳤다면 지문이 달라져 여기로 오지 않고 새 운영으로 반영된다.
          await tx.operationSession.update({
            data: {
              ...buildOperationSessionValueData({
                endDate: candidate.endDate,
                fields: candidate.fields,
                roleRoster,
                startDate: candidate.startDate
              }),
              deletedAt: null,
              deletedBy: null
            },
            where: { id: existingByFingerprint.id }
          });
          await linkSourceRecord(tx, sourceRecord.id, existingByFingerprint.id);
          summary.revived += 1;
          continue;
        }

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

/**
 * 같은 원천 행에서 만들어진 운영을 찾는다. **삭제된 것도 함께** 찾는다.
 *
 * 삭제된 것을 빼고 찾으면 "없다"고 판단해 새로 만들려 하는데, operationId가 지문에서
 * 결정적으로 나오고 operation_id는 @unique라 유니크 충돌로 반영 전체가 실패한다.
 * (실제로 "Unique constraint failed on the fields: (operation_id)"가 났다.)
 */
async function findExistingSessionByFingerprint(tx: Prisma.TransactionClient, sourceFingerprint: string | null) {
  if (!sourceFingerprint) return null;

  return tx.operationSession.findFirst({
    where: { sourceFingerprint },
    select: { deletedAt: true, id: true }
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

/**
 * 새로 만들 때 쓰는 데이터. 값 필드는 buildOperationSessionValueData가 만들고,
 * 여기서는 바꿀 수 없는 것(과정 연결·operationId·지문)만 얹는다.
 */
function buildOperationSessionCreateData(input: {
  courseRecordId: string;
  endDate: Date;
  fields: Record<string, string>;
  roleRoster: TeamMemberRoleRoster;
  sourceFingerprint: string | null;
  sourceTeam: SourceTeam;
  startDate: Date;
}): Prisma.OperationSessionCreateInput {
  return {
    ...buildOperationSessionValueData({
      endDate: input.endDate,
      fields: input.fields,
      roleRoster: input.roleRoster,
      startDate: input.startDate
    }),
    course: { connect: { id: input.courseRecordId } },
    operationId: stableOperationId(input.sourceTeam, input.sourceFingerprint),
    sourceFingerprint: input.sourceFingerprint
  };
}

/**
 * 원천 행에서 읽는 값 필드. 만들 때와 되살릴 때 둘 다 쓴다.
 *
 * 과정 연결·operationId·지문은 여기 없다 — 되살릴 때 바꾸면 안 되는 값이다.
 * (operationId는 지문에서 결정적으로 나오므로 지문이 같으면 값도 같고, 과정 연결도
 *  같은 지문이면 같은 기업·과정이라 다시 이을 필요가 없다.)
 */
function buildOperationSessionValueData(input: {
  endDate: Date;
  fields: Record<string, string>;
  roleRoster: TeamMemberRoleRoster;
  startDate: Date;
}) {
  const durationDays = dateDiffDays(input.startDate, input.endDate);

  return {
    archiveStatus: enumFromText(ARCHIVE_STATUS_BY_TEXT, input.fields.archiveStatus, ArchiveStatus.NOT_READY),
    coachText: nullableText(input.fields.coach),
    companyWikiLink: nullableText(input.fields.companyWikiLink),
    costRaw: nullableText(input.fields.costRaw),
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
    onsiteRequired: OnsiteRequired.UNKNOWN,
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

/**
 * 원천 행 지문에서 operationId를 만든다. **같은 지문이면 항상 같은 값**이다.
 *
 * 이 결정성이 재반영 시 "이미 있는 행"을 알아보게 해 주지만, operation_id가 @unique라
 * 삭제된 운영과 같은 지문을 다시 반영하면 유니크 충돌이 난다. 그래서 반영 전 중복 검사가
 * 삭제된 것까지 찾아야 한다(findExistingSessionByFingerprint).
 *
 * 지문이 없으면 임의값을 쓴다 — 그 경우는 재반영을 알아볼 수 없으므로 매번 새로 만든다.
 */
export function stableOperationId(sourceTeam: SourceTeam, sourceFingerprint: string | null) {
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
  if (typeof value !== "string") return "";

  return value
    .split("\n")
    .map((line) => line.trim().replace(/[^\S\n]+/g, " "))
    .join("\n")
    .trim();
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
