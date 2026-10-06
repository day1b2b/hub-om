export interface StoredDriveImportCandidate {
  confidence?: string;
  evidence?: string;
  field?: string;
  label?: string;
  reasons?: string[];
  score?: number;
  sourceTitle?: string;
  title?: string;
  url?: string;
  value?: string;
}

export interface StoredDriveImportResult {
  candidateCount: number;
  createdAt: string;
  fileCount: number;
  folderCandidates: StoredDriveImportCandidate[];
  folderTitle: string;
  folderUrl: string;
  inputKind: string;
  inputValue: string;
  issues: string[];
  keyCandidates: StoredDriveImportCandidate[];
  resultKind: string;
  runId: string;
  runStartedAt: string;
  runStatus: string;
}

export interface StoredDriveImportRunResult {
  candidateCount: number;
  companyName: string;
  courseName: string;
  createdAt: string;
  endDate: string;
  error: string;
  fileCount: number;
  folderCandidates: StoredDriveImportCandidate[];
  folderTitle: string;
  folderUrl: string;
  inputKind: string;
  inputValue: string;
  issues: string[];
  keyCandidates: StoredDriveImportCandidate[];
  operationId: string;
  resultKind: string;
  startDate: string;
}

export interface StoredDriveImportRunView {
  avgSatisfactionCandidateCount: number;
  errorCount: number;
  finishedAt: string;
  folderSearchCount: number;
  folderSearchWithCandidatesCount: number;
  id: string;
  instructorCandidateCount: number;
  instructorSatisfactionCandidateCount: number;
  mode: string;
  operationCount: number;
  results: StoredDriveImportRunResult[];
  scanFoundFolderCount: number;
  scanIssueCount: number;
  scannedRefCount: number;
  startedAt: string;
  status: string;
  suspiciousCandidateCount: number;
}

export interface DriveImportHistoryRepository {
  readLatestDriveImportResult(operationId: string): Promise<StoredDriveImportResult | null>;
  readLatestDriveImportRun(resultLimit?: number): Promise<StoredDriveImportRunView | null>;
}
