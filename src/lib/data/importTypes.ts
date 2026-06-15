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
  validationLogCount: number;
}

export interface SourceRecordPreview {
  id: string;
  sourceTeam: SourceTeamLabel;
  sourceRowNumber: number;
  headerRowNumber: number | null;
  sourceFingerprint: string;
  linkedOperationId: string;
  mappedFieldCount: number;
  unmappedFieldCount: number;
  validationErrors: string[];
  createdAt: string;
}

export interface ImportRunDetail extends ImportRunSummary {
  records: SourceRecordPreview[];
}
