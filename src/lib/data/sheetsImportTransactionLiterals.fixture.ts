/** V7 literals: no product parser, validation planner or presenter generates expected values. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const ROUTE = "/api/admin/imports/google-sheets/import";
export const TOKEN = "synthetic-sheets-transaction-token-never-store";
export const ERROR_CANARY = "synthetic-sheets-private-error-never-log";
export const EMAIL = "Synthetic.Sheets@day1company.co.kr";
export const ACTOR_NAME = "Synthetic Sheets Operator";
export const SHEET_ID = "syntheticSheetsTransaction20260930";
export const TAB = "Synthetic transaction tab";
export const SOURCE = "Synthetic transaction source";
export const OM = "가상운영자";
export const LD = "가상기획자";
export const INSTRUCTOR = "가상강사";
export const GENERIC_ERROR = "스프레드시트를 가져오지 못했습니다.";
export const HEADER_ERROR = "헤더로 사용할 행을 찾지 못했습니다. 시트에 제목 행과 데이터가 있는지 확인해 주세요.";
export const BODY = { spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
  tabTitle: TAB, sourceName: SOURCE, sourceTeam: "team_1", headerRowNumber: 1 };
export const TABLE = [
  ["companyName", "courseName", "startDate", "endDate", "om", "ld", "instructors", "syntheticExtra"],
  ["가상기업가", "가상과정가", "2026-09-30", "2026-10-01", OM, LD, INSTRUCTOR, "가상원문가"],
  ["가상기업나", "가상과정나", "2026-09-30", "2026-10-01", OM, LD, INSTRUCTOR, "가상원문나"]
];

// Explicit ordered fingerprint vectors, independent of the parser's sorting/normalization implementation.
function literalRow(rowNumber: number, company: string, course: string, extra: string) {
  const pairs = [["companyName", company], ["courseName", course], ["endDate", "2026-10-01"],
    ["instructors", INSTRUCTOR], ["ld", LD], ["om", OM], ["startDate", "2026-09-30"], ["syntheticExtra", extra]];
  return {
    rowNumber,
    rowSnapshot: { companyName: company, courseName: course, startDate: "2026-09-30", endDate: "2026-10-01",
      om: OM, ld: LD, instructors: INSTRUCTOR, syntheticExtra: extra },
    mappedFields: { companyName: company, courseName: course, endDate: "2026-10-01", instructors: INSTRUCTOR,
      ld: LD, om: OM, startDate: "2026-09-30" },
    unmappedFields: { syntheticExtra: extra }, validationErrors: [],
    sourceFingerprint: createHash("sha256").update(JSON.stringify(pairs)).digest("hex")
  };
}
export const PARSED = { headerRowNumber: 1, rows: [
  literalRow(2, "가상기업가", "가상과정가", "가상원문가"),
  literalRow(3, "가상기업나", "가상과정나", "가상원문나")
] };
export const DUPLICATE_LOGS = [
  { rowNumber: 2, errors: ["이미 같은 행이 저장되어 있어 중복 저장하지 않았습니다."] },
  { rowNumber: 3, errors: ["이미 같은 행이 저장되어 있어 중복 저장하지 않았습니다."] }
];
export function uuid(value: unknown): asserts value is string {
  assert.equal(typeof value, "string");
  assert.match(value as string, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
}
export function observedDate(value: unknown, from: number, to: number): asserts value is Date {
  assert.ok(value instanceof Date);
  assert.ok(Number.isFinite(value.getTime()) && value.getTime() >= from && value.getTime() <= to,
    "DB datetime must be within this request's observed wall-clock window");
}
export function successBody(id: string, duplicate = false) {
  return { ok: true, duplicateCount: duplicate ? 2 : 0, errorCount: duplicate ? 2 : 0,
    headerRowNumber: 1, importRunId: id, rowCount: 2, storedCount: duplicate ? 0 : 2 };
}

/** Only documented crypto companions are separated; every semantic key is compared below. */
export function semantic(row: Record<string, unknown>, companions: readonly string[]) {
  const result = { ...row };
  for (const key of companions) {
    assert.ok(Object.hasOwn(result, key), `Missing companion ${key}`);
    const field = key.slice(0, -"PiiIndex".length);
    if (result[field] === null) assert.equal(result[key], null);
    else assert.match(String(result[key]), /^[0-9a-f]{64}$/);
    delete result[key];
  }
  return result;
}
export function assertRun(row: Record<string, unknown>, id: string, from: number, to: number, duplicate = false) {
  uuid(row.id); assert.equal(row.id, id);
  observedDate(row.startedAt, from, to); observedDate(row.finishedAt, from, to);
  assert.deepEqual(semantic(row, ["sourceNamePiiIndex", "workbookNamePiiIndex", "fileNamePiiIndex", "importedByPiiIndex", "notesPiiIndex"]), {
    id, sourceTeam: "TEAM_1", sourceType: "spreadsheet", sourceName: SOURCE, workbookName: SHEET_ID,
    fileName: null, status: duplicate ? "COMPLETED_WITH_ERRORS" : "COMPLETED", rowCount: 2,
    successCount: duplicate ? 0 : 2, errorCount: duplicate ? 2 : 0, importedBy: EMAIL,
    startedAt: row.startedAt, finishedAt: row.finishedAt, notes: null, validationLogs: duplicate ? DUPLICATE_LOGS : []
  });
}
export function assertSourceRow(row: Record<string, unknown>, runId: string, from: number, to: number, index: number) {
  const expected = PARSED.rows[index]; assert.ok(expected);
  uuid(row.id); observedDate(row.createdAt, from, to);
  assert.deepEqual(semantic(row, ["sourceWorkbookPiiIndex", "sourceSheetPiiIndex"]), {
    id: row.id, importRunId: runId, operationSessionId: null, sourceTeam: "TEAM_1", sourceWorkbook: SHEET_ID,
    sourceSheet: TAB, sourceRowNumber: expected.rowNumber, headerRowNumber: 1,
    sourceFingerprint: expected.sourceFingerprint, rowSnapshot: expected.rowSnapshot,
    mappedFields: expected.mappedFields, unmappedFields: expected.unmappedFields,
    validationErrors: [], createdAt: row.createdAt
  });
}
