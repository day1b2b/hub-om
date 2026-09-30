import type { Prisma } from "@prisma/client";
import type { ImportPromotionRepository, ImportPromotionResult, ImportPromotionTransaction } from "./importPromotionContract";
import { promoteImportRows } from "./importPromotionCore";
import { getPrismaClient } from "./prisma";
import { PrismaTeamMemberRepository } from "./prismaTeamMemberRepository";

export class PrismaImportPromotionRepository implements ImportPromotionRepository {
  async promoteReadyImportRows(importRunId: string): Promise<ImportPromotionResult> {
    const prisma = getPrismaClient();
    const roleRoster = await new PrismaTeamMemberRepository().listRoleRosters();

    return prisma.$transaction(async (tx) => promoteImportRows(promotionTransaction(tx), importRunId, roleRoster));
  }
}

function promotionTransaction(tx: Prisma.TransactionClient): ImportPromotionTransaction {
  return {
    getRun(id) {
      return tx.dataImportRun.findUnique({
        where: { id },
        select: { sourceType: true }
      });
    },
    listUnlinkedSources(importRunId) {
      return tx.operationSourceRecord.findMany({
        where: {
          importRunId,
          operationSessionId: null
        },
        orderBy: [{ sourceSheet: "asc" }, { sourceRowNumber: "asc" }]
      });
    },
    async findByFingerprint(sourceFingerprint) {
      if (!sourceFingerprint) return null;

      return tx.operationSession.findFirst({
        where: { sourceFingerprint },
        select: { deletedAt: true, id: true }
      });
    },
    findByBusinessKey(input) {
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
    },
    upsertCompany(input) {
      return tx.company.upsert({
        where: { normalizedName: input.normalizedName },
        update: { name: input.name },
        create: {
          name: input.name,
          normalizedName: input.normalizedName
        }
      });
    },
    upsertCourse(input) {
      return tx.course.upsert({
        where: {
          companyId_courseId_name: {
            companyId: input.companyId,
            courseId: input.courseId,
            name: input.name
          }
        },
        update: {
          operationType: input.operationType,
          revenue: input.revenue,
          revenueRaw: input.revenueRaw
        },
        create: {
          companyId: input.companyId,
          courseId: input.courseId,
          name: input.name,
          operationType: input.operationType,
          revenue: input.revenue,
          revenueRaw: input.revenueRaw
        }
      });
    },
    createOperation({ courseRecordId, operationId, sourceFingerprint, ...values }) {
      return tx.operationSession.create({
        data: {
          ...values,
          course: { connect: { id: courseRecordId } },
          operationId,
          sourceFingerprint
        },
        select: { id: true }
      });
    },
    async restoreOperation(id, values) {
      await tx.operationSession.update({
        data: values,
        where: { id }
      });
    },
    async linkSource(sourceRecordId, operationSessionId) {
      await tx.operationSourceRecord.update({
        where: { id: sourceRecordId },
        data: { operationSessionId }
      });
    }
  };
}

function normalizeVisibleText(value: string | undefined): string {
  if (typeof value !== "string") return "";

  return value
    .split("\n")
    .map((line) => line.trim().replace(/[^\S\n]+/g, " "))
    .join("\n")
    .trim();
}

function normalizeName(value: string): string {
  return normalizeVisibleText(value).toLowerCase();
}
