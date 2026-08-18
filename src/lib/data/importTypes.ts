export type ImportRunStatus = "대기" | "완료" | "오류있음" | "실패";
export type SourceTeamLabel = "1팀" | "2팀" | "미확인";

export interface ImportRunSummary {
  id: string;
  sourceTeam: SourceTeamLabel;
  sourceType: string;
  status: ImportRunStatus;
  rowCount: number;
  successCount: number;
  errorCount: number;
  sourceRecordCount: number;
  importedBy: string;
  startedAt: string;
  finishedAt: string;
  notes: string;
  fileName: string;
  validationLogCount: number;
}

export interface SourceRecordPreview {
  id: string;
  sourceTeam: SourceTeamLabel;
  sourceRowNumber: number;
  headerRowNumber: number | null;
  sourceFingerprint: string;
  linkedOperationId: string;
  linkedOperation: LinkedOperationPreview | null;
  mappedFieldCount: number;
  mappedFields: SourceRecordFieldPreview[];
  unmappedFieldCount: number;
  unmappedFields: SourceRecordFieldPreview[];
  rowSnapshotPreview: SourceRecordFieldPreview[];
  reviewStatus: SourceRecordReviewStatus;
  validationErrors: string[];
  createdAt: string;
}

export interface ImportRunDetail extends ImportRunSummary {
  records: SourceRecordPreview[];
}

export type SourceRecordReviewStatus = "적용 준비" | "확인 필요" | "매칭 필요";

export interface SourceRecordFieldPreview {
  key: string;
  label: string;
  value: string;
}

export interface LinkedOperationPreview {
  operationId: string;
  companyName: string;
  courseName: string;
  dateRange: string;
}
