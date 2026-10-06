/** Independent Notion V5 literals. Expected rows never call the product reader/parser/planner. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const ROUTE = "/api/admin/imports/notion/import";
export const TOKEN = "synthetic-notion-transaction-server-token-never-store";
export const ERROR_CANARY = "synthetic-notion-private-error-never-log";
export const EMAIL = "Synthetic.Notion@day1company.co.kr";
export const ACTOR_NAME = "Synthetic Notion Operator";
export const DATABASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const DATABASE_URL = `https://example.invalid/${DATABASE_ID}`;
export const SOURCE_SHEET = "Notion";
export const SOURCE = "Synthetic Notion transaction source";
export const OM = "가상운영자";
export const LD = "가상기획자";
export const INSTRUCTOR = "가상강사";
export const GENERIC_ERROR = "Notion 데이터를 가져오지 못했습니다.";
export const BODY = { databaseUrl: DATABASE_URL, sourceName: SOURCE, sourceTeam: "team_1",
  token: "synthetic-body-token-must-not-select-credential" };
export const CURSOR = "synthetic-next-page-cursor";
export const PAGE_IDS = ["11111111-1111-4111-8111-000000000001", "22222222-2222-4222-8222-000000000002"];
export const PAGE_URLS = ["https://example.invalid/synthetic-notion-page-a", "https://example.invalid/synthetic-notion-page-b"];

// Transport inputs are raw JSON-compatible Notion pages, not pre-parsed source port results.
function page(index: number, company: string, course: string, memo: string) {
  return { id: PAGE_IDS[index], url: PAGE_URLS[index], properties: {
    "기업명": { type: "rich_text", rich_text: [{ plain_text: ` ${company} ` }] },
    "과정명": { type: "title", title: [{ plain_text: course }] },
    Date: { type: "date", date: { start: "2026-09-30T09:00:00+09:00", end: "2026-10-01T18:00:00+09:00" } },
    "운영": { type: "people", people: [{ name: OM }] },
    "기획": { type: "people", people: [{ name: LD }] },
    "강사": { type: "rich_text", rich_text: [{ plain_text: INSTRUCTOR }] },
    "Tags": { type: "multi_select", multi_select: [{ name: memo }, { name: "공유메모" }] },
    ignoredSyntheticProperty: { type: "rich_text", rich_text: [{ plain_text: "이 원천 속성은 매핑되지 않음" }] }
  } };
}
export const RAW_PAGES = [page(0, "가상기업가", "가상과정가", "가상메모가"), page(1, "가상기업나", "가상과정나", "가상메모나")];
export const PAYLOADS = [
  { results: [RAW_PAGES[0]], has_more: true, next_cursor: CURSOR },
  { results: [RAW_PAGES[1]], has_more: false, next_cursor: null }
];
export function expectedFetch(index: number) {
  assert.ok(index === 0 || index === 1, "pagination must issue exactly two fetches");
  return {
    url: `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
    options: { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json",
      "Notion-Version": "2022-06-28" }, cache: "no-store",
      body: index === 0 ? '{"page_size":100}' : '{"page_size":100,"start_cursor":"synthetic-next-page-cursor"}' }
  };
}

function literalRow(rowNumber: number, operationId: string, url: string, company: string, course: string, memo: string) {
  // Handwritten Unicode key order for this fixed fixture; no shared product sorter or mapper.
  const pairs = [["강사", INSTRUCTOR], ["과정명", course], ["기업명", company], ["담당LD", LD], ["담당OM", OM],
    ["시작일", "2026-09-30"], ["싱크업", url], ["운영ID", operationId], ["종료일", "2026-10-01"], ["특이사항", memo]];
  return {
    rowNumber,
    rowSnapshot: { "운영ID": operationId, "기업명": company, "과정명": course, "시작일": "2026-09-30", "종료일": "2026-10-01",
      "담당OM": OM, "담당LD": LD, "강사": INSTRUCTOR, "특이사항": memo, "싱크업": url },
    mappedFields: { companyName: company, courseName: course, endDate: "2026-10-01", instructors: INSTRUCTOR,
      ld: LD, om: OM, operationId, operationDetail: url, specialNotes: memo, startDate: "2026-09-30" },
    unmappedFields: {}, validationErrors: [], sourceFingerprint: createHash("sha256").update(JSON.stringify(pairs)).digest("hex")
  };
}
export const PARSED = { headerRowNumber: 1, rows: [
  literalRow(2, "NOTION-11111111111141118111000000000001", PAGE_URLS[0], "가상기업가", "가상과정가", "가상메모가, 공유메모"),
  literalRow(3, "NOTION-22222222222242228222000000000002", PAGE_URLS[1], "가상기업나", "가상과정나", "가상메모나, 공유메모")
] };
export const READER_RESULT = { databaseId: DATABASE_ID, rowCount: 2, parsed: PARSED };
export function assertReader(value: unknown) { assert.deepEqual(value, READER_RESULT); }
export function uuid(value: unknown): asserts value is string {
  assert.equal(typeof value, "string");
  assert.match(value as string, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
}
export function observedDate(value: unknown, from: number, to: number): asserts value is Date {
  assert.ok(value instanceof Date);
  assert.ok(Number.isFinite(value.getTime()) && value.getTime() >= from && value.getTime() <= to);
}
export function successBody(id: string) {
  return { ok: true, duplicateCount: 0, errorCount: 0, importRunId: id, rowCount: 2, storedCount: 2 };
}
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
export function assertRun(row: Record<string, unknown>, id: string, from: number, to: number) {
  uuid(row.id); assert.equal(row.id, id);
  observedDate(row.startedAt, from, to); observedDate(row.finishedAt, from, to);
  assert.deepEqual(semantic(row, ["sourceNamePiiIndex", "workbookNamePiiIndex", "fileNamePiiIndex", "importedByPiiIndex", "notesPiiIndex"]), {
    id, sourceTeam: "TEAM_1", sourceType: "notion", sourceName: SOURCE, workbookName: DATABASE_ID,
    fileName: null, status: "COMPLETED", rowCount: 2, successCount: 2, errorCount: 0, importedBy: EMAIL,
    startedAt: row.startedAt, finishedAt: row.finishedAt, notes: null, validationLogs: []
  });
}
export function assertSourceRow(row: Record<string, unknown>, runId: string, from: number, to: number, index: number) {
  const expected = PARSED.rows[index]; assert.ok(expected);
  uuid(row.id); observedDate(row.createdAt, from, to);
  assert.deepEqual(semantic(row, ["sourceWorkbookPiiIndex", "sourceSheetPiiIndex"]), {
    id: row.id, importRunId: runId, operationSessionId: null, sourceTeam: "TEAM_1", sourceWorkbook: DATABASE_ID,
    sourceSheet: SOURCE_SHEET, sourceRowNumber: expected.rowNumber, headerRowNumber: 1,
    sourceFingerprint: expected.sourceFingerprint, rowSnapshot: expected.rowSnapshot,
    mappedFields: expected.mappedFields, unmappedFields: {}, validationErrors: [], createdAt: row.createdAt
  });
}
