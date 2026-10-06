/** Independent synthetic semantics/literals. Never imports a product DTO builder, comparator or selector. */
import assert from "node:assert/strict";
export type Row = Record<string, unknown>;
export interface RunView extends Row { results: Row[] }
export interface Reader {
  readLatestDriveImportRun(take?: number): Promise<RunView | null>;
  readLatestDriveImportResult(operationId: string): Promise<Row | null>;
}
export const AT = "2032-02-03T04:05:06.000Z";
export const OLD = "2031-02-03T04:05:06.000Z";
export const LATE = "2033-02-03T04:05:06.000Z";
export const runId = (index: number) => `61000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
export const resultId = (index: number) => `62000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
export function runSeed(index = 1, values: Row = {}): Row {
  return { id: runId(index), mode: "dry_run", status: "PENDING", operationCount: 101,
    scannedRefCount: 102, scanFoundFolderCount: 103, scanIssueCount: 104, folderSearchCount: 105,
    folderSearchWithCandidatesCount: 106, avgSatisfactionCandidateCount: 107, instructorSatisfactionCandidateCount: 108,
    instructorCandidateCount: 109, suspiciousCandidateCount: 110, errorCount: 111,
    summary: { privateSummary: "SYNTHETIC_NOT_RETURNED_SUMMARY" }, notes: "SYNTHETIC_NOT_RETURNED_NOTES",
    startedAt: new Date(AT), finishedAt: null, ...values };
}
export function resultSeed(index = 1, values: Row = {}): Row {
  return { id: resultId(index), runId: runId(1), operationSessionId: null,
    operationId: `op-${index}`, companyName: "Synthetic company", courseName: "Synthetic course",
    startDate: null, endDate: null, inputKind: "folderSearch", inputValue: null, resultKind: "folder_search_empty",
    folderId: "SYNTHETIC_NOT_RETURNED_FOLDER", folderTitle: null, folderUrl: null,
    fileCount: 0, candidateCount: 0, keyCandidates: [], folderCandidates: [], issues: [], error: null,
    createdAt: new Date(AT), ...values };
}
// Expected values are separate literals, not a projection of seed objects.
export function expectedRun(results: Row[], values: Row = {}): RunView {
  return { avgSatisfactionCandidateCount: 107, errorCount: 111, finishedAt: "", folderSearchCount: 105,
    folderSearchWithCandidatesCount: 106, id: runId(1), instructorCandidateCount: 109,
    instructorSatisfactionCandidateCount: 108, mode: "dry_run", operationCount: 101, results,
    scanFoundFolderCount: 103, scanIssueCount: 104, scannedRefCount: 102, startedAt: AT, status: "PENDING",
    suspiciousCandidateCount: 110, ...values };
}
export function expectedRow(index = 1, values: Row = {}): Row {
  return { candidateCount: 0, companyName: "Synthetic company", courseName: "Synthetic course", createdAt: AT,
    endDate: "", error: "", fileCount: 0, folderCandidates: [], folderTitle: "", folderUrl: "",
    inputKind: "folderSearch", inputValue: "", issues: [], keyCandidates: [], operationId: `op-${index}`,
    resultKind: "folder_search_empty", startDate: "", ...values };
}
export function expectedSingle(values: Row = {}): Row {
  return { candidateCount: 0, createdAt: AT, fileCount: 0, folderCandidates: [], folderTitle: "", folderUrl: "",
    inputKind: "folderSearch", inputValue: "", issues: [], keyCandidates: [], resultKind: "folder_search_empty",
    runId: runId(1), runStartedAt: AT, runStatus: "PENDING", ...values };
}
export const inputKeyCandidates = [null, false, 0, "discard", {}, [], { field: "instructors", value: "사내", evidence: "SYNTHETIC_EVIDENCE", extra: { retained: [1, true, null] } }, { value: { legacyObject: true } }];
export const expectedKeyCandidates = [{}, [], { field: "instructors", value: "사내", evidence: "SYNTHETIC_EVIDENCE", extra: { retained: [1, true, null] } }, { value: { legacyObject: true } }];
export const richSeed: Row = { operationId: " Op-Exact ", companyName: "회사 A", courseName: "과정 B",
  startDate: new Date("2032-02-01T00:00:00.000Z"), endDate: new Date("2032-02-04T00:00:00.000Z"),
  inputKind: "driveLink", inputValue: "SYNTHETIC_INPUT", resultKind: "error", folderTitle: "SYNTHETIC_FOLDER",
  folderUrl: "https://example.invalid/folder", candidateCount: 37, fileCount: 9,
  keyCandidates: inputKeyCandidates, folderCandidates: [{ title: "SYNTHETIC_CANDIDATE", score: 3, reasons: ["SYNTHETIC_REASON"] }],
  issues: [null, 0, false, "", "SYNTHETIC_ISSUE"], error: "SYNTHETIC_STORED_ERROR" };
export const richRow = expectedRow(1, { operationId: " Op-Exact ", companyName: "회사 A", courseName: "과정 B",
  startDate: "2032-02-01", endDate: "2032-02-04", inputKind: "driveLink", inputValue: "SYNTHETIC_INPUT",
  resultKind: "error", folderTitle: "SYNTHETIC_FOLDER", folderUrl: "https://example.invalid/folder", candidateCount: 37, fileCount: 9,
  keyCandidates: expectedKeyCandidates, folderCandidates: [{ title: "SYNTHETIC_CANDIDATE", score: 3, reasons: ["SYNTHETIC_REASON"] }],
  issues: ["", "SYNTHETIC_ISSUE"], error: "SYNTHETIC_STORED_ERROR" });
export const richSingle = expectedSingle({ inputKind: "driveLink", inputValue: "SYNTHETIC_INPUT", resultKind: "error",
  folderTitle: "SYNTHETIC_FOLDER", folderUrl: "https://example.invalid/folder", candidateCount: 37, fileCount: 9,
  keyCandidates: expectedKeyCandidates, folderCandidates: [{ title: "SYNTHETIC_CANDIDATE", score: 3, reasons: ["SYNTHETIC_REASON"] }], issues: ["", "SYNTHETIC_ISSUE"] });
export function assertExact(actual: unknown, literal: unknown) { assert.deepEqual(actual, literal); }
export function assertOneComplete(actual: unknown, literals: unknown[]) {
  assert.ok(literals.some(value => { try { assertExact(actual, value); return true; } catch { return false; } }), "not one complete allowed DTO");
}
/** Ordered groups, exact cardinality, multiset membership. Never sorts product output. */
export function assertGroups(actual: Row[], groups: Array<{ rows: Row[]; count: number }>) {
  assert.equal(actual.length, groups.reduce((n, group) => n + group.count, 0)); let offset = 0;
  for (const group of groups) {
    const available = group.rows.slice();
    for (const row of actual.slice(offset, offset + group.count)) {
      const index = available.findIndex(expected => { try { assertExact(row, expected); return true; } catch { return false; } });
      assert.ok(index >= 0, "wrong identity/value/order or lost multiplicity"); available.splice(index, 1);
    }
    offset += group.count;
  }
}
export function comparatorControls() {
  const literal = expectedRun([richRow, expectedRow(2)]);
  const modifications: unknown[] = [];
  const missing = structuredClone(literal); delete missing.status; modifications.push(missing);
  modifications.push({ ...literal, unexpected: true }, { ...literal, finishedAt: null }, { ...literal, operationCount: 102 },
    { ...literal, results: [...literal.results].reverse() }, { ...literal, results: [{ ...richRow, candidateCount: 0 }, expectedRow(2)] });
  for (const wrong of modifications) assert.throws(() => assertExact(wrong, literal));
  assertExact(Object.fromEntries(Object.entries(literal).reverse()), literal);
  assertGroups([expectedRow(2), expectedRow(2)], [{ rows: [expectedRow(2), expectedRow(2)], count: 2 }]);
  assert.throws(() => assertGroups([expectedRow(2)], [{ rows: [expectedRow(2), expectedRow(2)], count: 2 }]));
  assert.throws(() => assertGroups([expectedRow(2), expectedRow(2)], [{ rows: [expectedRow(2), expectedRow(3)], count: 2 }]));
}
export const DB_NULL = Symbol("fixture-db-null");
export const JSON_NULL = Symbol("fixture-json-null");
