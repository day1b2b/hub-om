import assert from "node:assert/strict";
import { MongoDbNull } from "./mongoRuntimeCodec";
import type { MongoRow } from "./mongoOperationStore";
import type { DriveImportOperation, DriveImportSummary } from "./driveImportWriterRepository";
import type { DriveImportScanResult } from "../driveImports/driveImportTypes";

// Independent literals from the frozen CLI contract; never call product mapping/count helpers here.
export const ERROR_CODE = "DRIVE_IMPORT_WRITER_FAILED";
export const SOURCE_CANARY = "synthetic-source-private-error";
export const DRIVER_CANARY = "synthetic-driver-private mongodb://private.invalid/token";
export const ARGS = { concurrency: 1, limit: 0, mode: "synthetic-mode-record-only" };
export const INPUT = { kind: "driveLink", value: "https://drive.example.invalid/synthetic-folder" };
export const ZERO: DriveImportSummary = {
  avgSatisfactionCandidates: 0, errors: 0, folderSearches: 0, folderSearchWithCandidates: 0,
  instructorCandidates: 0, instructorSatisfactionCandidates: 0, scanFoundFolder: 0,
  scanIssues: 0, scannedRefs: 0, suspiciousCandidateCount: 0,
  suspicious: { badInstructorFragments: 0, clockInstructorCandidates: 0, zeroSatisfactionCandidates: 0 }
};
export const SCAN_SUMMARY: DriveImportSummary = {
  avgSatisfactionCandidates: 1, errors: 0, folderSearches: 0, folderSearchWithCandidates: 0,
  instructorCandidates: 1, instructorSatisfactionCandidates: 0, scanFoundFolder: 1,
  scanIssues: 1, scannedRefs: 1, suspiciousCandidateCount: 2,
  suspicious: { badInstructorFragments: 0, clockInstructorCandidates: 1, zeroSatisfactionCandidates: 1 }
};
export const KEYS = [
  { confidence: "high", evidence: "", field: "avgSatisfaction", label: "Synthetic rating", sourceTitle: "Synthetic source", value: "0.00" },
  { confidence: "needs_review", evidence: "Synthetic evidence", field: "instructors", label: "Synthetic instructor", sourceTitle: "Synthetic source", value: "시계" }
];
export function scanPayload(): DriveImportScanResult {
  return {
    folderId: "synthetic-folder-id", folderTitle: "Synthetic private folder", folderUrl: "https://drive.example.invalid/synthetic-folder",
    scannedAt: "2032-01-01T00:00:00.000Z", issues: ["synthetic-issue-one", "synthetic-issue-two"],
    files: [
      { id: "synthetic-file-1", title: "Synthetic file one", mimeType: "text/plain", folderPath: "root" },
      { id: "synthetic-file-2", title: "Synthetic file two", mimeType: "text/plain", folderPath: "root" }
    ],
    candidates: [
      { id: "synthetic-candidate-1", field: "avgSatisfaction", label: "Synthetic rating", value: "0.00", action: "replace", confidence: "high", sourceTitle: "Synthetic source", applyable: true },
      { id: "synthetic-candidate-2", field: "instructors", label: "Synthetic instructor", value: "시계", action: "append", confidence: "needs_review", sourceTitle: "Synthetic source", evidence: "Synthetic evidence", applyable: false },
      { id: "synthetic-candidate-3", field: "companyName", label: "Excluded field", value: "Excluded candidate", action: "reference", confidence: "medium", sourceTitle: "Synthetic source", applyable: false }
    ]
  };
}
export function uuid(value: unknown): asserts value is string {
  assert.equal(typeof value, "string"); assert.match(value as string, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
}
export function time(value: unknown, from: number, to: number): Date {
  assert.ok(value instanceof Date); assert.ok(Number.isFinite(value.getTime()) && value.getTime() >= from && value.getTime() <= to);
  return value;
}
export function expectedOperation(id: string, operationId = "SYNTHETIC-OP", date = "2032-01-01"): DriveImportOperation {
  return { id, operationId, companyName: "Synthetic company", courseName: "Synthetic course",
    startDate: date, endDate: date, om: "Synthetic OM", ld: "Synthetic LD",
    driveLink: `  ${INPUT.value}  `, lectureManagementLink: "https://example.invalid/synthetic-lecture" };
}
export function runRow(id: string, startedAt: Date, summary: DriveImportSummary | null = null,
  status = "PENDING", finishedAt: Date | null = null, operationCount = 1): MongoRow {
  return { id, mode: ARGS.mode, status, operationCount,
    scannedRefCount: summary?.scannedRefs ?? 0, scanFoundFolderCount: summary?.scanFoundFolder ?? 0,
    scanIssueCount: summary?.scanIssues ?? 0, folderSearchCount: summary?.folderSearches ?? 0,
    folderSearchWithCandidatesCount: summary?.folderSearchWithCandidates ?? 0,
    avgSatisfactionCandidateCount: summary?.avgSatisfactionCandidates ?? 0,
    instructorSatisfactionCandidateCount: summary?.instructorSatisfactionCandidates ?? 0,
    instructorCandidateCount: summary?.instructorCandidates ?? 0, suspiciousCandidateCount: summary?.suspiciousCandidateCount ?? 0,
    errorCount: summary?.errors ?? 0, summary: summary ?? MongoDbNull,
    notes: "Read-only Drive import dry run. Operation data is not modified.", startedAt, finishedAt };
}
export function resultRow(id: string, createdAt: Date, runId: string, operation: DriveImportOperation, override: MongoRow = {}): MongoRow {
  return { id, createdAt, runId, operationSessionId: operation.id, operationId: operation.operationId,
    companyName: operation.companyName, courseName: operation.courseName,
    startDate: operation.startDate ? new Date(`${operation.startDate}T00:00:00.000Z`) : null,
    endDate: operation.endDate ? new Date(`${operation.endDate}T00:00:00.000Z`) : null,
    inputKind: "driveLink", inputValue: INPUT.value, resultKind: "scan_found_folder",
    folderId: "synthetic-folder-id", folderTitle: "Synthetic private folder", folderUrl: INPUT.value,
    fileCount: 2, candidateCount: 3, keyCandidates: structuredClone(KEYS), folderCandidates: [],
    issues: ["synthetic-issue-one", "synthetic-issue-two"], error: null, ...override };
}
export const ERROR_RESULT = {
  resultKind: "error", folderId: null, folderTitle: null, folderUrl: null, fileCount: 0,
  candidateCount: 0, keyCandidates: [], folderCandidates: [], issues: [], error: ERROR_CODE
};
/** Full tuples and independent ID sets, not counts or IDs obtained from final storage. */
export function assertRows(actual: MongoRow[], expected: MongoRow[]): void {
  assert.equal(new Set(actual.map(row => row.id)).size, actual.length, "duplicate identity");
  assert.equal(new Set(expected.map(row => row.id)).size, expected.length, "invalid expected identities");
  const sort = (rows: MongoRow[]) => [...rows].sort((a, b) => Buffer.compare(Buffer.from(a.id as string), Buffer.from(b.id as string)));
  assert.deepEqual(sort(actual), sort(expected));
}
export function readerRun(run: MongoRow, results: MongoRow[]) {
  return {
    avgSatisfactionCandidateCount: run.avgSatisfactionCandidateCount, errorCount: run.errorCount,
    finishedAt: run.finishedAt ? (run.finishedAt as Date).toISOString() : "", folderSearchCount: run.folderSearchCount,
    folderSearchWithCandidatesCount: run.folderSearchWithCandidatesCount, id: run.id,
    instructorCandidateCount: run.instructorCandidateCount, instructorSatisfactionCandidateCount: run.instructorSatisfactionCandidateCount,
    mode: run.mode, operationCount: run.operationCount,
    results: results.map(row => ({ candidateCount: row.candidateCount, companyName: row.companyName, courseName: row.courseName,
      createdAt: (row.createdAt as Date).toISOString(), endDate: row.endDate ? (row.endDate as Date).toISOString().slice(0, 10) : "",
      error: row.error ?? "", fileCount: row.fileCount, folderCandidates: row.folderCandidates, folderTitle: row.folderTitle ?? "",
      folderUrl: row.folderUrl ?? "", inputKind: row.inputKind, inputValue: row.inputValue ?? "", issues: row.issues,
      keyCandidates: row.keyCandidates, operationId: row.operationId, resultKind: row.resultKind,
      startDate: row.startDate ? (row.startDate as Date).toISOString().slice(0, 10) : "" })),
    scanFoundFolderCount: run.scanFoundFolderCount, scanIssueCount: run.scanIssueCount, scannedRefCount: run.scannedRefCount,
    startedAt: (run.startedAt as Date).toISOString(), status: run.status, suspiciousCandidateCount: run.suspiciousCandidateCount
  };
}
export function readerResult(run: MongoRow, row: MongoRow) {
  return { candidateCount: row.candidateCount, createdAt: (row.createdAt as Date).toISOString(), fileCount: row.fileCount,
    folderCandidates: row.folderCandidates, folderTitle: row.folderTitle ?? "", folderUrl: row.folderUrl ?? "",
    inputKind: row.inputKind, inputValue: row.inputValue ?? "", issues: row.issues, keyCandidates: row.keyCandidates,
    resultKind: row.resultKind, runId: run.id, runStartedAt: (run.startedAt as Date).toISOString(), runStatus: run.status };
}
