import type { Prisma } from "@prisma/client";
import type { TeamMemberRoleRoster } from "./teamMemberRepository";

export type OperationImportEntry = Record<string, Prisma.JsonValue> & {
  companyName: string;
  courseId: string;
  courseName: string;
  endDate: string;
  operationId: string;
  startDate: string;
};

export interface OperationImportSummary {
  inserted: number;
  operations: number;
  sourceRecordsInserted: number;
  sourceRecordsSkipped: number;
  updated: number;
}

export interface OperationImportPort {
  createImportRun(fileName: string, rowCount: number): Promise<{ id: string }>;
  finishImportRun(id: string, rowCount: number, successCount: number): Promise<void>;
  findOperationById(operationId: string): Promise<{ id: string } | null>;
  findOperationByBusinessKey(input: { companyName: string; courseName: string; startDate: Date; endDate: Date }): Promise<{ id: string } | null>;
  upsertCompany(input: { name: string; normalizedName: string }): Promise<{ id: string }>;
  upsertCourse(input: { companyId: string; courseId: string; name: string; operationType: string; revenue: number | null; revenueRaw: string | null }): Promise<{ id: string }>;
  createOperation(input: { operationId: string; courseRecordId: string; values: Record<string, unknown> }): Promise<{ id: string }>;
  updateOperation(id: string, courseRecordId: string, values: Record<string, unknown>): Promise<void>;
  sourceRecordExists(operationSessionId: string, sourceFingerprint: string): Promise<boolean>;
  createSourceRecord(input: { importRunId: string; operationSessionId: string; rowNumber: number; sourceFingerprint: string; sourceTeam: string; snapshot: OperationImportEntry }): Promise<void>;
}

export interface OperationImportRepository {
  importOperations(entries: readonly OperationImportEntry[], fileName: string, apply: boolean): Promise<OperationImportSummary>;
}

export interface OperationImportDependencies {
  port: OperationImportPort;
  roster: TeamMemberRoleRoster;
}
