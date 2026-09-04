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
  /**
   * 반영에 필요한데 비어 있는 필드의 라벨. 서버가 정규화된 전체 필드로 계산한다.
   * 화면에 내려가는 mappedFields 미리보기는 앞 12개만 담기므로 그것으로 판단하면
   * 기업명이 13번째에 있는 행이 "없음"으로 잘못 표시된다.
   */
  missingRequiredFields: string[];
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
