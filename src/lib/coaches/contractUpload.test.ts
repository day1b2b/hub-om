import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateRawSync } from "node:zlib";
import { mock, test } from "node:test";

// 업로드 경로는 구글을 부르지 않아야 한다. 부르면 바로 실패하게 막아 둔다.
mock.module("./googleServiceAccount", { namedExports: {
  GoogleSheetReadError: class extends Error {},
  readGoogleServiceAccountConfig: () => ({ serviceAccountEmail: "", privateKey: "" }),
  async readGoogleSpreadsheetRows() { throw new Error("Google must not be called for uploads"); },
  async readGoogleSheetValues() { throw new Error("Google must not be called for uploads"); }
} });
const sentinel = new Error("SYNTHETIC_UPLOAD_COMPOSITION");
let compositionCalls = 0;
mock.module("@/auth", { namedExports: { auth: async () => null } });
mock.module("@/lib/data/coachSyncComposition", { namedExports: { runCoachSyncRequest: async () => { compositionCalls++; throw sentinel; } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const uploadRoute = await import("../../app/api/sync/engagements/upload/route");
hooks.deregister();
const { readUploadedContractWorkbook, syncUploadedContractEngagements } = await import("./contractSheetSync");
const { SheetSourceReadError } = await import("./sheetReadFailure");
const { runWithDataRepositories } = await import("../data/dataRepositoryContext");

// 최소 xlsx(zip)를 직접 만든다(xlsxReader.test와 같은 방식).
function buildXlsx(files: Array<{ name: string; content: string }>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8"), raw = Buffer.from(file.content, "utf8"), body = deflateRawSync(raw), crc = crc32(raw);
    const head = Buffer.alloc(30 + name.length);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(name.length, 26);
    name.copy(head, 30); local.push(head, body);
    const entry = Buffer.alloc(46 + name.length);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42); name.copy(entry, 46); central.push(entry);
    offset += head.length + body.length;
  }
  const localBuffer = Buffer.concat(local), centralBuffer = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(localBuffer.length, 16);
  return Buffer.concat([localBuffer, centralBuffer, end]);
}
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (~crc) >>> 0;
}
const cell = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
function contractWorkbook(sheetName: string): Buffer {
  return buildXlsx([
    { name: "xl/workbook.xml", content: `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: "xl/styles.xml", content: '<?xml version="1.0"?><styleSheet><fonts><font/></fonts><cellXfs><xf fontId="0"/></cellXfs></styleSheet>' },
    { name: "xl/worksheets/sheet1.xml", content: `<?xml version="1.0"?><worksheet><sheetData><row r="1">${cell("E1", "코치")}${cell("H1", "과정명")}</row><row r="2">${cell("E2", "합성코치")}${cell("H2", "합성과정")}</row></sheetData></worksheet>` }
  ]);
}

test("uploaded contract workbook is read from the configured tab without Google", () => {
  const { values } = readUploadedContractWorkbook(contractWorkbook("조교실습코치_일반계약요청"));
  assert.equal(values.length, 2);
  assert.equal(values[1][4], "합성코치");
  assert.equal(values[1][7], "합성과정");
});

test("a wrong tab or a non-xlsx file gives a fixed message without file contents", () => {
  assert.throws(() => readUploadedContractWorkbook(contractWorkbook("다른탭")), (error: unknown) =>
    error instanceof SheetSourceReadError && /탭이나 범위를 찾을 수 없습니다\('조교실습코치_일반계약요청'!A:Q\)/.test(error.message));
  assert.throws(() => readUploadedContractWorkbook(Buffer.from("synthetic not a zip")), (error: unknown) =>
    error instanceof SheetSourceReadError && /엑셀\(\.xlsx\) 파일이 맞는지/.test(error.message) && !/synthetic/.test(error.message));
});

test("uploaded preview runs the same sync rules against the scoped repository", async () => {
  const forbidden = async () => { throw new Error("Unexpected write in dry run"); };
  const repository = {
    listLiveCoaches: async () => [], findLiveCoachByName: forbidden, getCoach: forbidden, findMatchingEngagement: forbidden,
    listEngagementsByCourseNames: forbidden, listReservationCoachIdsForEngagements: forbidden, transaction: forbidden
  };
  await runWithDataRepositories({ coachSheetSync: repository }, async () => {
    const result = await syncUploadedContractEngagements(contractWorkbook("조교실습코치_일반계약요청"), true);
    assert.equal(result.totalRows, 1);
    // 날짜가 없는 행은 오류로 남기고 건너뛴다(구글 경로와 같은 규칙).
    assert.equal(result.skipped, 1);
    assert.match(result.errorDetail[0], /날짜 누락: 합성코치/);
  });
});

test("the upload route enters the shared coach sync composition boundary", async () => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(contractWorkbook("조교실습코치_일반계약요청"))], "contract.xlsx"));
  await assert.rejects(uploadRoute.POST(new Request("https://example.invalid/api/sync/engagements/upload", { method: "POST", body: form })), (error) => error === sentinel);
  assert.equal(compositionCalls, 1);
});
