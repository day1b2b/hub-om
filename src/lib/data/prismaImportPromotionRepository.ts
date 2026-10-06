import { MemberRole, Prisma, type SourceTeam } from "@prisma/client";
import type { ImportPromotionRepository, ImportPromotionResult, ImportPromotionTransaction, SourceOnlyPromotionRepository, SourceOnlyPromotionResult } from "./importPromotionContract";
import { promoteImportRows, promoteSourceOnlyRows } from "./importPromotionCore";
import { getPrismaClient } from "./prisma";
import { PrismaTeamMemberRepository } from "./prismaTeamMemberRepository";

export class PrismaImportPromotionRepository implements ImportPromotionRepository, SourceOnlyPromotionRepository {
  async promoteReadyImportRows(importRunId: string): Promise<ImportPromotionResult> {
    const prisma = getPrismaClient();
    const roleRoster = await new PrismaTeamMemberRepository().listRoleRosters();

    return prisma.$transaction(async (tx) => promoteImportRows(promotionTransaction(tx), importRunId, roleRoster));
  }

  async promoteSourceOnlyRows(sourceTeam: SourceTeam, apply: boolean): Promise<SourceOnlyPromotionResult> {
    const prisma = getPrismaClient();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await prisma.$transaction(async tx => {
          const [sources, members] = await Promise.all([
            tx.operationSourceRecord.findMany({ where: { sourceTeam, operationSessionId: null }, orderBy: [{ sourceSheet: "asc" }, { sourceRowNumber: "asc" }] }),
            tx.member.findMany({ where: { isActive: true, role: { in: [MemberRole.OM, MemberRole.LD] } } })
          ]);
          members.sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.sourceTeam).localeCompare(String(b.sourceTeam))
            || (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name, "ko"));
          const roster = { om: {} as Record<string, string[]>, ld: {} as Record<string, string[]> };
          for (const member of members) {
            if (!member.role) continue;
            const role = member.role === MemberRole.OM ? "om" : "ld";
            const team = member.sourceTeam === "TEAM_1" ? "1팀" : member.sourceTeam === "TEAM_2" ? "2팀" : "미분류";
            roster[role][team] = [...(roster[role][team] ?? []), member.name];
          }
          return promoteSourceOnlyRows(promotionTransaction(tx), sources, roster, apply);
        }, { isolationLevel: apply ? Prisma.TransactionIsolationLevel.Serializable : Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 60_000 });
      } catch (error) {
        if (apply && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 4) continue;
        throw error;
      }
    }
    throw new Error("SOURCE_ONLY_PROMOTION_CONCURRENT_CHANGE");
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
