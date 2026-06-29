import { inflateRawSync } from "node:zlib";

export interface SpreadsheetRows {
  values: string[][];
  struckCells: Set<string>;
}

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
}

interface ParsedRange {
  sheetName: string;
  startCol: number;
  endCol: number;
  startRow: number;
  endRow: number;
}

export function readXlsxRows(buffer: Buffer, range: string): SpreadsheetRows {
  const entries = readZipEntries(buffer);
  const files = new Map(entries.map((entry) => [entry.name, readZipEntry(buffer, entry).toString("utf8")]));
  const parsedRange = parseRange(range);
  const workbook = files.get("xl/workbook.xml");
  const workbookRels = files.get("xl/_rels/workbook.xml.rels");
  if (!workbook || !workbookRels) throw new Error("Excel workbook 구조를 읽을 수 없습니다.");

  const sheetPath = resolveSheetPath(workbook, workbookRels, parsedRange.sheetName);
  const sheetXml = files.get(sheetPath);
  if (!sheetXml) throw new Error(`Excel 시트를 찾을 수 없습니다: ${parsedRange.sheetName}`);

  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml") ?? "");
  const struckStyleIndexes = parseStruckStyleIndexes(files.get("xl/styles.xml") ?? "");
  return parseSheetRows(sheetXml, sharedStrings, struckStyleIndexes, parsedRange);
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Excel ZIP 중앙 디렉터리를 읽을 수 없습니다.");
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    entries.push({ name, compression, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`Excel ZIP 항목을 읽을 수 없습니다: ${entry.name}`);
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) return inflateRawSync(compressed);
  throw new Error(`지원하지 않는 Excel 압축 방식입니다: ${entry.compression}`);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Excel ZIP 종료 레코드를 찾을 수 없습니다.");
}

function resolveSheetPath(workbookXml: string, relsXml: string, sheetName: string): string {
  const sheetRegex = /<sheet\b([^>]*)\/?>/g;
  let sheetMatch: RegExpExecArray | null;
  let relationshipId: string | null = null;

  while ((sheetMatch = sheetRegex.exec(workbookXml))) {
    const attrs = parseAttributes(sheetMatch[1]);
    if (attrs.name === sheetName) {
      relationshipId = attrs["r:id"] ?? null;
      break;
    }
  }

  if (!relationshipId) throw new Error(`Excel workbook에서 시트를 찾을 수 없습니다: ${sheetName}`);

  const relRegex = /<Relationship\b([^>]*)\/?>/g;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRegex.exec(relsXml))) {
    const attrs = parseAttributes(relMatch[1]);
    if (attrs.Id === relationshipId && attrs.Target) {
      return normalizeWorkbookTarget(attrs.Target);
    }
  }

  throw new Error(`Excel workbook 관계를 찾을 수 없습니다: ${sheetName}`);
}

function parseSharedStrings(xml: string): string[] {
  if (!xml) return [];
  const result: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((item) => decodeXml(item[1]));
    result.push(parts.join(""));
  }
  return result;
}

function parseStruckStyleIndexes(xml: string): Set<number> {
  const result = new Set<number>();
  if (!xml) return result;

  const fontsSection = xml.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)?.[1] ?? "";
  const fontStrikeById = Array.from(fontsSection.matchAll(/<font\b[^>]*>([\s\S]*?)<\/font>/g)).map((match) =>
    /<strike\b/.test(match[1])
  );

  const cellXfsSection = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  Array.from(cellXfsSection.matchAll(/<xf\b([^>]*)\/?>/g)).forEach((match, index) => {
    const fontId = Number(parseAttributes(match[1]).fontId ?? 0);
    if (fontStrikeById[fontId]) result.add(index);
  });

  return result;
}

function parseSheetRows(
  sheetXml: string,
  sharedStrings: string[],
  struckStyleIndexes: Set<number>,
  range: ParsedRange
): SpreadsheetRows {
  const values: string[][] = [];
  const struckCells = new Set<string>();
  const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cellMatch: RegExpExecArray | null;

  while ((cellMatch = cellRegex.exec(sheetXml))) {
    const attrs = parseAttributes(cellMatch[1]);
    const ref = parseCellRef(attrs.r);
    if (!ref) continue;
    if (ref.col < range.startCol || ref.col > range.endCol || ref.row < range.startRow || ref.row > range.endRow) {
      continue;
    }

    const rowIndex = ref.row - range.startRow;
    const colIndex = ref.col - range.startCol;
    while (values.length <= rowIndex) values.push([]);
    values[rowIndex][colIndex] = parseCellValue(cellMatch[2] ?? "", attrs.t, sharedStrings);

    const styleIndex = attrs.s ? Number(attrs.s) : null;
    if (styleIndex != null && struckStyleIndexes.has(styleIndex)) {
      struckCells.add(`${rowIndex}:${colIndex}`);
    }
  }

  return { values: values.map((row) => row.map((value) => value ?? "")), struckCells };
}

function parseCellValue(cellXml: string, type: string | undefined, sharedStrings: string[]): string {
  if (type === "inlineStr") {
    return Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((match) => decodeXml(match[1])).join("");
  }

  const rawValue = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") return sharedStrings[Number(rawValue)] ?? "";
  return decodeXml(rawValue);
}

function parseRange(range: string): ParsedRange {
  const [rawSheetName, rawCells = "A:XFD"] = range.split("!");
  const sheetName = unquoteSheetName(rawSheetName);
  const [startRaw, endRaw = startRaw] = rawCells.split(":");
  const start = parseA1Ref(startRaw) ?? { col: 0, row: 1 };
  const end = parseA1Ref(endRaw) ?? { col: start.col, row: Number.MAX_SAFE_INTEGER };

  return {
    sheetName,
    startCol: start.col,
    endCol: end.col,
    startRow: start.row,
    endRow: end.row
  };
}

function parseA1Ref(value: string): { col: number; row: number } | null {
  const match = value.match(/^([A-Z]+)(\d+)?$/i);
  if (!match) return null;
  return {
    col: columnToIndex(match[1]),
    row: match[2] ? Number(match[2]) : 1
  };
}

function parseCellRef(value: string | undefined): { col: number; row: number } | null {
  if (!value) return null;
  const match = value.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return { col: columnToIndex(match[1]), row: Number(match[2]) };
}

function columnToIndex(value: string): number {
  return value.toUpperCase().split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function unquoteSheetName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function normalizeWorkbookTarget(target: string): string {
  const normalized = target.replace(/^\/+/, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function parseAttributes(raw: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!raw) return attrs;
  for (const match of raw.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
