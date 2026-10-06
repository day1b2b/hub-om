import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { buildOperationCreateTemplateCsv, OPERATION_CREATE_TEMPLATE_HEADER } from "./operationCreateTemplate";
import { parsePastedRounds } from "./parsePastedRounds";

test("다운로드 CSV를 스프레드시트로 읽고 붙여넣어도 비연속 실제교육일이 유지된다", () => {
  const book = XLSX.read(buildOperationCreateTemplateCsv(), { type: "string", raw: true });
  const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1, defval: "" });
  assert.deepEqual(rows[0], OPERATION_CREATE_TEMPLATE_HEADER);
  assert.equal(rows[1].length, 8);
  const [round] = parsePastedRounds(rows[1].join("\t"));
  assert.deepEqual(round.errors, []);
  assert.equal(round.region, "");
  assert.deepEqual(round.educationDates, ["2026-09-03", "2026-09-04", "2026-09-07"]);
});

test("기존 지역 포함 8열 붙여넣기 계약을 유지한다", () => {
  const [round] = parsePastedRounds("1\t2026-09-03\t2026-09-07\t09:00 ~ 10:00\t\t\t가상지역\t2026-09-03, 2026-09-07");
  assert.deepEqual(round.errors, []);
  assert.equal(round.region, "가상지역");
  assert.deepEqual(round.educationDates, ["2026-09-03", "2026-09-07"]);
});
