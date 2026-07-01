import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";

import { readXlsxRows } from "./xlsxReader.ts";

// 최소 xlsx(zip) 바이트를 직접 만든다. 외부 의존성 없이 readXlsxRows를 검증하기 위함.
function buildXlsx(files: Array<{ name: string; content: string }>): Buffer {
  const encoder = new TextEncoder();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(encoder.encode(file.name));
    const raw = Buffer.from(encoder.encode(file.content));
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);

    offset += local.length + compressed.length;
  }

  const localBuffer = Buffer.concat(localParts);
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localBuffer.length, 16);
  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function cell(ref: string, text: string, style?: number): string {
  const s = style != null ? ` s="${style}"` : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t>${text}</t></is></c>`;
}

function sampleWorkbook(): Buffer {
  const workbook =
    '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
  const styles =
    '<?xml version="1.0"?><styleSheet>' +
    "<fonts><font><sz val=\"11\"/></font><font><strike/></font></fonts>" +
    '<cellXfs><xf fontId="0"/><xf fontId="1"/></cellXfs></styleSheet>';
  const sheet =
    '<?xml version="1.0"?><worksheet><sheetData>' +
    `<row r="1">${cell("E1", "코치")}${cell("H1", "과정명")}</row>` +
    `<row r="2">${cell("E2", "홍길동")}${cell("H2", "리더십과정")}</row>` +
    `<row r="3">${cell("E3", "김철수")}${cell("H3", "취소과정", 1)}</row>` +
    "</sheetData></worksheet>";

  return buildXlsx([
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: rels },
    { name: "xl/styles.xml", content: styles },
    { name: "xl/worksheets/sheet1.xml", content: sheet }
  ]);
}

test("행 번호 없는 열 전체 범위('A:Q')도 데이터 행을 모두 읽는다", () => {
  const buffer = sampleWorkbook();
  const { values } = readXlsxRows(buffer, "'Sheet1'!A:Q");
  // 헤더 1행 + 데이터 2행 = 3행이어야 한다. (회귀: 과거엔 헤더 1행만 반환했다)
  assert.equal(values.length, 3);
  assert.equal(values[1][4], "홍길동");
  assert.equal(values[2][7], "취소과정");
});

test("취소선이 그어진 셀을 struckCells로 표시한다", () => {
  const buffer = sampleWorkbook();
  const { struckCells } = readXlsxRows(buffer, "'Sheet1'!A:Q");
  // 3행(데이터 index 2) H열(index 7)에 취소선
  assert.ok(struckCells.has("2:7"));
  assert.ok(!struckCells.has("1:7"));
});

test("행 번호를 명시한 범위도 동일하게 동작한다", () => {
  const buffer = sampleWorkbook();
  const { values } = readXlsxRows(buffer, "'Sheet1'!A1:Q1000");
  assert.equal(values.length, 3);
});
