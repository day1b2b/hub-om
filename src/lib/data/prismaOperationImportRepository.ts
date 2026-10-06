import { MemberRole, Prisma, type PrismaClient } from "@prisma/client";
import { importOperationRows, OperationImportDryRun } from "./operationImportCore";
import type { OperationImportEntry, OperationImportPort, OperationImportRepository } from "./operationImportRepository";

export class PrismaOperationImportRepository implements OperationImportRepository {
  private readonly client: PrismaClient;
  constructor(client: PrismaClient) { this.client = client; }
  async importOperations(entries: readonly OperationImportEntry[], fileName: string, apply: boolean) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.client.$transaction(async tx => {
          const members = await tx.member.findMany({ where: { isActive: true, role: { in: [MemberRole.OM, MemberRole.LD] } } });
          members.sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.sourceTeam).localeCompare(String(b.sourceTeam)) || (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name, "ko"));
          const roster = { om: {} as Record<string, string[]>, ld: {} as Record<string, string[]> };
          for (const member of members) { const role = member.role === MemberRole.OM ? "om" : "ld", team = member.sourceTeam === "TEAM_1" ? "1팀" : member.sourceTeam === "TEAM_2" ? "2팀" : "미분류"; roster[role][team] = [...(roster[role][team] ?? []), member.name]; }
          const result = await importOperationRows({ port: port(tx), roster }, entries, fileName);
          if (!apply) throw new OperationImportDryRun(result);
          return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 60_000 });
      } catch (error) {
        if (error instanceof OperationImportDryRun) return error.summary;
        if (apply && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 4) continue;
        throw new Error("OPERATION_IMPORT_FAILED");
      }
    }
    throw new Error("OPERATION_IMPORT_CONCURRENT_CHANGE");
  }
}

function port(tx: Prisma.TransactionClient): OperationImportPort {
  return {
    createImportRun(fileName, rowCount) { return tx.dataImportRun.create({ data: { sourceTeam: "UNKNOWN", sourceType: "legacy_json", sourceName: "Local JSON operation import", fileName, status: "PENDING", rowCount, notes: "Imported from local standardized operation JSON." }, select: { id: true } }); },
    async finishImportRun(id, rowCount, successCount) { await tx.dataImportRun.update({ where: { id }, data: { status: "COMPLETED", successCount, errorCount: rowCount - successCount, finishedAt: new Date(), notes: "Import completed." } }); },
    findOperationById(operationId) { return tx.operationSession.findUnique({ where: { operationId }, select: { id: true } }); },
    findOperationByBusinessKey(input) { return tx.operationSession.findFirst({ where: { deletedAt: null, startDate: input.startDate, endDate: input.endDate, course: { name: input.courseName, company: { normalizedName: input.companyName.toLowerCase() } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } }); },
    upsertCompany(input) { return tx.company.upsert({ where: { normalizedName: input.normalizedName }, update: { name: input.name }, create: input, select: { id: true } }); },
    upsertCourse(input) { const data = { operationType: input.operationType as Prisma.EnumOperationTypeFieldUpdateOperationsInput["set"], revenue: input.revenue, revenueRaw: input.revenueRaw }; return tx.course.upsert({ where: { companyId_courseId_name: { companyId: input.companyId, courseId: input.courseId, name: input.name } }, update: data, create: { ...data, companyId: input.companyId, courseId: input.courseId, name: input.name }, select: { id: true } }); },
    createOperation(input) { return tx.operationSession.create({ data: { ...(input.values as Prisma.OperationSessionUncheckedCreateInput), operationId: input.operationId, courseRecordId: input.courseRecordId }, select: { id: true } }); },
    async updateOperation(id, courseRecordId, values) { await tx.operationSession.update({ where: { id }, data: { ...(values as Prisma.OperationSessionUncheckedUpdateInput), courseRecordId } }); },
    async sourceRecordExists(operationSessionId, sourceFingerprint) { return (await tx.operationSourceRecord.findFirst({ where: { operationSessionId, sourceFingerprint }, select: { id: true } })) !== null; },
    async createSourceRecord(input) { await tx.operationSourceRecord.create({ data: { importRunId: input.importRunId, operationSessionId: input.operationSessionId, sourceTeam: input.sourceTeam as "TEAM_1" | "TEAM_2" | "UNKNOWN", sourceWorkbook: "local-standardized-operations", sourceSheet: "operations", sourceRowNumber: input.rowNumber, sourceFingerprint: input.sourceFingerprint, rowSnapshot: input.snapshot, mappedFields: input.snapshot, validationErrors: Array.isArray(input.snapshot.validationErrors) ? input.snapshot.validationErrors : [] } }); }
  };
}
