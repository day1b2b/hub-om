import type { OperationType, Prisma, SourceTeam } from "@prisma/client";
import type { buildOperationSessionValueData } from "./importPromotionCore";

export const NOTION_PROMOTION_ERROR = "Notion 가져오기는 검수용으로만 저장합니다. 중복 방지를 위해 운영 데이터 반영은 막혀 있습니다.";

export interface ImportPromotionResult {
  blocked: number;
  blockedReasons: Record<string, number>;
  created: number;
  eligible: number;
  linkedExisting: number;
  /** 같은 원천 지문으로 삭제된 운영을 되살린 건수. */
  revived: number;
  sourceRows: number;
}

export interface ImportPromotionSource {
  id: string;
  mappedFields: Prisma.JsonValue | null;
  validationErrors: Prisma.JsonValue | null;
  sourceFingerprint: string | null;
  sourceTeam: SourceTeam;
}

export type ImportPromotionValues = ReturnType<typeof buildOperationSessionValueData>;
export type ImportPromotionCreateData = ImportPromotionValues & {
  courseRecordId: string;
  operationId: string;
  sourceFingerprint: string | null;
};
export type ImportPromotionRestoreData = ImportPromotionValues & {
  deletedAt: null;
  deletedBy: null;
};

export interface ImportPromotionBusinessKey {
  companyName: string;
  courseName: string;
  startDate: Date;
  endDate: Date;
}

export interface ImportPromotionCompanyInput {
  name: string;
  normalizedName: string;
}

export interface ImportPromotionCourseInput {
  companyId: string;
  courseId: string;
  name: string;
  operationType: OperationType;
  revenue: number | null;
  revenueRaw: string | null;
}

/** 한 transaction 안에서만 사용하는 업무 포트. 원천 행은 기존 sheet/row 순서를 유지한다. */
export interface ImportPromotionTransaction {
  getRun(id: string): Promise<{ sourceType: string } | null>;
  listUnlinkedSources(runId: string): Promise<ImportPromotionSource[]>;
  findByFingerprint(value: string | null): Promise<{ id: string; deletedAt: Date | null } | null>;
  findByBusinessKey(input: ImportPromotionBusinessKey): Promise<{ id: string } | null>;
  upsertCompany(input: ImportPromotionCompanyInput): Promise<{ id: string }>;
  upsertCourse(input: ImportPromotionCourseInput): Promise<{ id: string }>;
  createOperation(data: ImportPromotionCreateData): Promise<{ id: string }>;
  restoreOperation(id: string, values: ImportPromotionRestoreData): Promise<void>;
  /** operationSessionId는 SRC 식별자가 아닌 OperationSession UUID다. */
  linkSource(sourceId: string, operationSessionId: string): Promise<void>;
}

export interface ImportPromotionRepository {
  promoteReadyImportRows(importRunId: string): Promise<ImportPromotionResult>;
}
