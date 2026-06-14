import type { UpdateOperationInput } from "@/lib/data/operationTypes";

export type DriveImportCandidateAction = "replace" | "append" | "reference";

export type DriveImportCandidateField = keyof UpdateOperationInput | "companyName" | "courseName" | "startDate";

export type DriveImportConfidence = "high" | "medium" | "needs_review";

export interface DriveImportCandidate {
  id: string;
  field: DriveImportCandidateField;
  label: string;
  value: string;
  action: DriveImportCandidateAction;
  confidence: DriveImportConfidence;
  sourceFileId?: string;
  sourceTitle: string;
  sourceUrl?: string;
  evidence?: string;
  applyable: boolean;
}

export interface DriveImportFileSummary {
  id: string;
  title: string;
  mimeType: string;
  url?: string;
  folderPath: string;
  modifiedTime?: string;
}

export interface DriveFolderSearchCandidate {
  companyMatched: boolean;
  confidence: DriveImportConfidence;
  folderId: string;
  modifiedTime?: string;
  ownerNames: string[];
  reasons: string[];
  score: number;
  title: string;
  url?: string;
}

export interface DriveFolderSearchResult {
  candidates: DriveFolderSearchCandidate[];
  issues: string[];
  searchedAt: string;
}

export interface DriveImportScanResult {
  folderId: string;
  folderTitle: string;
  folderUrl: string;
  scannedAt: string;
  candidates: DriveImportCandidate[];
  files: DriveImportFileSummary[];
  issues: string[];
}
