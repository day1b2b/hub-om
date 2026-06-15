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

const FIELD_ALIASES: Record<string, string[]> = {
  companyName: ["company", "companyname", "customer", "customername", "고객사", "고객사명", "기업", "기업명"],
  courseId: ["courseid", "coursecode", "코스id", "코스아이디", "과정id", "과정코드"],
  courseName: ["course", "coursename", "program", "programname", "과정", "과정명", "교육명", "프로그램명"],
  endDate: ["enddate", "endedat", "종료일", "종료날짜", "교육종료일"],
  instructors: ["instructor", "instructors", "강사", "강사명"],
  ld: ["ld", "러닝디자이너", "기획자"],
  om: ["om", "운영매니저", "운영담당자", "담당om"],
  operationId: ["operationid", "운영id", "운영아이디"],
  startDate: ["startdate", "startedat", "시작일", "시작날짜", "교육시작일"]
};

export function parseImportFile(fileName: string, content: string): ParsedImportFile {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "json") {
    return parseJsonImport(content);
  }

  if (extension === "csv" || extension === "txt") {
    return parseCsvImport(content);
  }

  throw new Error("CSV 또는 JSON 파일만 업로드할 수 있습니다.");
}

function parseJsonImport(content: string): ParsedImportFile {
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
      .map((row, index) => buildParsedRow(row, index + 2))
  };
}

function parseCsvImport(content: string): ParsedImportFile {
  const table = parseCsvTable(content).filter((row) => row.some((cell) => cell.trim()));
  return parseImportTable(table, 1);
}

export function parseImportTable(table: string[][], headerRowNumber = 1): ParsedImportFile {
  const normalizedTable = table.map((row) => row.map((cell) => String(cell ?? "").trim()));
  const headerIndex = Math.max(0, headerRowNumber - 1);
  const headers = normalizedTable[headerIndex]?.map((header) => header.trim()) ?? [];

  if (headers.length === 0) {
    throw new Error("헤더 행이 비어 있습니다.");
  }

  return {
    headerRowNumber,
    rows: normalizedTable
      .slice(headerIndex + 1)
      .map((row, index) => rowToObject(headers, row, headerRowNumber + index + 1))
      .filter((row) => Object.keys(row).length > 0)
      .map((row, index) => buildParsedRow(row, Number(row.__sourceRowNumber) || headerRowNumber + index + 1))
  };
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

function buildParsedRow(rowSnapshot: Record<string, string>, rowNumber: number): ParsedImportRow {
  const mappedFields = mapKnownFields(rowSnapshot);
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

function mapKnownFields(row: Record<string, string>) {
  const mappedFields: Record<string, string> = {};

  for (const [fieldName, aliases] of Object.entries(FIELD_ALIASES)) {
    const match = Object.entries(row).find(([key]) => aliases.includes(normalizeHeader(key)));

    if (match?.[1]) {
      mappedFields[fieldName] = match[1];
    }
  }

  return mappedFields;
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
  return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(value.trim()) || /^\d{1,2}[-/.]\d{1,2}$/.test(value.trim());
}

function hashRow(row: Record<string, string>) {
  const stableJson = JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key]]));
  return createHash("sha256").update(stableJson).digest("hex");
}
