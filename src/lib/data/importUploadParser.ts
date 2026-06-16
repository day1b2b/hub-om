import { createHash } from "node:crypto";

export interface ParsedImportRow {
  mappedFields: Record<string, string>;
  rowNumber: number;
  rowSnapshot: Record<string, string>;
  sourceFingerprint: string;
  unmappedFields: Record<string, string>;
  validationErrors: string[];
}

export interface ParsedImportFile {
  headerRowNumber: number;
  rows: ParsedImportRow[];
}

export interface ParseImportOptions {
  defaultYear?: number;
}

const FIELD_ALIASES: Record<string, string[]> = {
  archiveStatus: ["archivestatus", "archive", "아카이빙", "아카이빙상태"],
  avgSatisfaction: ["avgsatisfaction", "averagesatisfaction", "전체만족도", "전반만족도", "평균만족도", "만족도"],
  coach: ["coach", "coaches", "실습코치", "코치"],
  companyName: ["company", "companyname", "customer", "customername", "고객사", "고객사명", "기업", "기업명"],
  companyWikiLink: ["companywikilink", "companywiki", "기업위키", "기업위키링크"],
  costRaw: ["costraw", "비용", "비용원문"],
  courseId: ["courseid", "coursecode", "코스id", "코스아이디", "과정id", "과정코드"],
  courseName: ["course", "coursename", "program", "programname", "과정", "과정명", "교육명", "프로그램명"],
  driveLink: ["drive", "drivelink", "googledrive", "구글드라이브", "드라이브", "드라이브링크", "폴더", "폴더링크"],
  educationDays: ["educationdays", "durationdays", "교육일수", "운영일수", "일수"],
  educationFormat: ["educationformat", "format", "교육형태", "운영형태", "운영방식", "진행방식"],
  endDate: ["enddate", "endedat", "종료일", "종료날짜", "교육종료일"],
  hasResultReport: ["hasresultreport", "resultreportstatus", "결과보고서", "결과보고서여부", "결과보고"],
  instructorCost: ["instructorcost", "강사비"],
  instructorSatisfaction: ["instructorsatisfaction", "강사만족도"],
  instructorWikiLink: ["instructorwikilink", "instructorwiki", "강사위키", "강사위키링크"],
  instructors: ["instructor", "instructors", "강사", "강사명"],
  ld: ["ld", "러닝디자이너", "기획자", "담당ld"],
  lectureManagementLink: ["lecturemanagementlink", "lecturemanagement", "강의관리", "강의관리링크", "강의관리시트"],
  om: ["om", "운영매니저", "운영담당자", "담당om"],
  omUpdate: ["omupdate", "운영업데이트", "업데이트사항", "업데이트사항om기재"],
  onsiteText: ["onsitetext", "현장투입", "현장운영"],
  operationId: ["operationid", "운영id", "운영아이디"],
  operationDetail: ["operationdetail", "syncup", "싱크업", "운영상세", "상세링크"],
  operationIssue: ["operationissue", "issue", "issues", "운영이슈", "이슈"],
  operationStatus: ["operationstatus", "status", "상태", "운영상태", "진행상태", "배정상태"],
  operationType: ["operationtype", "운영규모", "운영유형", "운영구분", "과정유형"],
  padletLink: ["padletlink", "padlet", "패들렛", "패들렛링크"],
  profitRaw: ["profitraw", "수익", "수익원문"],
  region: ["region", "지역", "장소", "교육장소"],
  resultReportLink: ["resultreportlink", "결과보고서링크", "결과보고링크"],
  roundNo: ["roundno", "round", "회차", "차수"],
  sessionDurationDays: ["sessiondurationdays", "교육기간일수", "기간일수"],
  sessionDurationType: ["sessiondurationtype", "운영기간유형", "기간유형"],
  specialNotes: ["specialnotes", "notes", "note", "특이사항", "메모"],
  startDate: ["startdate", "startedat", "시작일", "시작날짜", "교육시작일"],
  timeText: ["timetext", "time", "시간", "교육시간", "운영시간"],
  totalCost: ["totalcost", "총비용", "전체비용"]
};

const FIELD_ALIAS_LOOKUP = new Map(
  Object.entries(FIELD_ALIASES).flatMap(([fieldName, aliases]) => aliases.map((alias) => [alias, fieldName]))
);

export function parseImportFile(fileName: string, content: string, options: ParseImportOptions = {}): ParsedImportFile {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "json") {
    return parseJsonImport(content, options);
  }

  if (extension === "csv" || extension === "txt") {
    return parseCsvImport(content, options);
  }

  throw new Error("CSV 또는 JSON 파일만 업로드할 수 있습니다.");
}

function parseJsonImport(content: string, options: ParseImportOptions): ParsedImportFile {
  const parsed = JSON.parse(content) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : null;

  if (!rows) {
    throw new Error("JSON은 object 배열이거나 { rows: [...] } 형태여야 합니다.");
  }

  return {
    headerRowNumber: 1,
    rows: rows
      .map(normalizeJsonRow)
      .filter((row) => Object.keys(row).length > 0)
      .map((row, index) => buildParsedRow(row, index + 2, options))
  };
}

function parseCsvImport(content: string, options: ParseImportOptions): ParsedImportFile {
  const table = parseCsvTable(content).filter((row) => row.some((cell) => cell.trim()));
  return parseImportTable(table, 1, options);
}

export function parseImportTable(
  table: string[][],
  headerRowNumber = 1,
  options: ParseImportOptions = {}
): ParsedImportFile {
  const normalizedTable = table.map((row) => row.map((cell) => String(cell ?? "").trim()));
  const requestedHeaderIndex = Math.max(0, headerRowNumber - 1);
  const headerIndex = findHeaderIndex(normalizedTable, requestedHeaderIndex);
  const headers = normalizedTable[headerIndex]?.map((header) => header.trim()) ?? [];

  if (headers.length === 0) {
    throw new Error("헤더로 사용할 행을 찾지 못했습니다. 시트에 제목 행과 데이터가 있는지 확인해 주세요.");
  }

  return {
    headerRowNumber: headerIndex + 1,
    rows: normalizedTable
      .slice(headerIndex + 1)
      .map((row, index) => rowToObject(headers, row, headerIndex + index + 2))
      .filter((row) => Object.keys(row).length > 0)
      .map((row, index) => buildParsedRow(row, Number(row.__sourceRowNumber) || headerIndex + index + 2, options))
  };
}

function findHeaderIndex(table: string[][], requestedHeaderIndex: number) {
  const requestedScore = scoreHeaderRow(table[requestedHeaderIndex]);
  const scoredRows = table
    .map((row, index) => ({ index, score: scoreHeaderRow(row) }))
    .filter((row) => indexAtOrAfter(row.index, requestedHeaderIndex) && row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const bestRow = scoredRows[0];

  if (bestRow && bestRow.score >= Math.max(2, requestedScore + 1)) {
    return bestRow.index;
  }

  if (hasCells(table[requestedHeaderIndex])) {
    return requestedHeaderIndex;
  }

  const nextHeaderIndex = table.findIndex((row, index) => index >= requestedHeaderIndex && hasCells(row));
  return nextHeaderIndex >= 0 ? nextHeaderIndex : requestedHeaderIndex;
}

function hasCells(row: string[] | undefined) {
  return Boolean(row?.some((cell) => cell.trim()));
}

function indexAtOrAfter(index: number, requestedHeaderIndex: number) {
  return index >= requestedHeaderIndex;
}

function scoreHeaderRow(row: string[] | undefined) {
  if (!row) return 0;

  const matchedFields = new Set<string>();

  for (const cell of row) {
    const normalized = normalizeHeader(cell);
    const fieldName = FIELD_ALIAS_LOOKUP.get(normalized);

    if (fieldName) {
      matchedFields.add(fieldName);
    }
  }

  let score = matchedFields.size;

  if (matchedFields.has("companyName")) score += 2;
  if (matchedFields.has("courseName")) score += 2;
  if (matchedFields.has("startDate")) score += 2;
  if (matchedFields.has("endDate")) score += 2;
  if (matchedFields.has("om")) score += 1;
  if (matchedFields.has("ld")) score += 1;

  return score;
}

function normalizeJsonRow(row: unknown): Record<string, string> {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>)
      .map(([key, value]) => [key.trim(), valueToCell(value)])
      .filter(([key, value]) => key && value)
  );
}

function rowToObject(headers: string[], row: string[], rowNumber: number) {
  const object: Record<string, string> = {};

  headers.forEach((header, index) => {
    const key = header || `column_${index + 1}`;
    const value = row[index]?.trim() ?? "";

    if (value) {
      object[key] = value;
    }
  });

  if (Object.keys(object).length === 0) {
    return {};
  }

  object.__sourceRowNumber = String(rowNumber);
  return object;
}

function buildParsedRow(rowSnapshot: Record<string, string>, rowNumber: number, options: ParseImportOptions): ParsedImportRow {
  const mappedFields = mapKnownFields(rowSnapshot, options);
  const mappedSourceKeys = new Set(
    Object.keys(rowSnapshot).filter((key) => Object.values(FIELD_ALIASES).some((aliases) => aliases.includes(normalizeHeader(key))))
  );
  const unmappedFields = Object.fromEntries(
    Object.entries(rowSnapshot).filter(([key]) => !mappedSourceKeys.has(key) && key !== "__sourceRowNumber")
  );
  const validationErrors = validateMappedFields(mappedFields);
  const cleanSnapshot = Object.fromEntries(Object.entries(rowSnapshot).filter(([key]) => key !== "__sourceRowNumber"));

  return {
    mappedFields,
    rowNumber,
    rowSnapshot: cleanSnapshot,
    sourceFingerprint: hashRow(cleanSnapshot),
    unmappedFields,
    validationErrors
  };
}

function mapKnownFields(row: Record<string, string>, options: ParseImportOptions) {
  const mappedFields: Record<string, string> = {};

  for (const [fieldName, aliases] of Object.entries(FIELD_ALIASES)) {
    const match = Object.entries(row).find(([key]) => aliases.includes(normalizeHeader(key)));

    if (match?.[1]) {
      mappedFields[fieldName] = normalizeMappedValue(fieldName, match[1], options);
    }
  }

  return mappedFields;
}

function normalizeMappedValue(fieldName: string, value: string, options: ParseImportOptions) {
  if (fieldName === "startDate" || fieldName === "endDate") {
    return normalizeDateValue(value, options.defaultYear) ?? value;
  }

  return value;
}

function validateMappedFields(mappedFields: Record<string, string>) {
  const errors: string[] = [];

  if (!mappedFields.operationId && !mappedFields.companyName && !mappedFields.courseName) {
    errors.push("운영 ID, 기업명, 과정명 중 하나 이상이 필요합니다.");
  }

  if (mappedFields.startDate && !isDateLike(mappedFields.startDate)) {
    errors.push("시작일 형식을 확인해야 합니다.");
  }

  if (mappedFields.endDate && !isDateLike(mappedFields.endDate)) {
    errors.push("종료일 형식을 확인해야 합니다.");
  }

  return errors;
}

function parseCsvTable(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (char === "\"" && inQuotes && nextChar === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[\s_()[\]{}\-./]+/g, "").trim();
}

function valueToCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function isDateLike(value: string) {
  return Boolean(normalizeDateValue(value, 2026)) || /^\d{1,2}\s*[-/.]\s*\d{1,2}$/.test(value.trim());
}

function normalizeDateValue(value: string, defaultYear?: number) {
  const text = value
    .trim()
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ");

  const fullYearMatch =
    /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})$/.exec(text) ??
    /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/.exec(text);

  if (fullYearMatch) {
    return formatDateParts(Number(fullYearMatch[1]), Number(fullYearMatch[2]), Number(fullYearMatch[3]));
  }

  const shortYearMatch = /^(\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})$/.exec(text);

  if (shortYearMatch) {
    return formatDateParts(2000 + Number(shortYearMatch[1]), Number(shortYearMatch[2]), Number(shortYearMatch[3]));
  }

  const monthDayMatch = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})$/.exec(text);

  if (monthDayMatch && defaultYear) {
    return formatDateParts(defaultYear, Number(monthDayMatch[1]), Number(monthDayMatch[2]));
  }

  return null;
}

function formatDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function hashRow(row: Record<string, string>) {
  const stableJson = JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key]]));
  return createHash("sha256").update(stableJson).digest("hex");
}
