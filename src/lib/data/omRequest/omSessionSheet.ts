import * as XLSX from "xlsx";
import { parseEducationDatesText } from "../operationCalculations";
import { calcSessionDuration, type OmRequestSession } from "./omRequestTypes";

export const SESSION_SHEET_HEADERS = ["회차", "시작일", "종료일", "시작시간", "종료시간", "장소", "실제교육일"] as const;
export const SESSION_SHEET_FILE_NAME = "OM업무요청_교육일정_샘플.xlsx";

const TEXT_FORMAT = "@";
const TEMPLATE_ROW_COUNT = 10;
const TIME_PATTERN = /^([01]\d|2[0-3]):(00|30)$/;

const EXAMPLE_ROW = ["1", "2026-08-12", "2026-08-13", "09:00", "18:00", "서울 강남구 ○○빌딩 3층", ""];

export function buildSessionSheetWorkbook(): XLSX.WorkBook {
  const rows = [
    EXAMPLE_ROW,
    ...Array.from({ length: TEMPLATE_ROW_COUNT - 1 }, (_, i) => [String(i + 2), "", "", "", "", "", ""])
  ];
  const worksheet = XLSX.utils.aoa_to_sheet([[...SESSION_SHEET_HEADERS], ...rows]);

  const range = XLSX.utils.decode_range(worksheet["!ref"] as string);
  for (let r = 1; r <= range.e.r; r++) {
    for (let c = 1; c <= 4; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[address];
      if (cell) cell.z = TEXT_FORMAT;
    }
  }
  worksheet["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 30 }, { wch: 36 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "교육일정");
  return workbook;
}

export interface ParsedSessionRow {
  rowNumber: number;
  session: OmRequestSession;
  errors: string[];
}

export interface ParsedSessionSheet {
  rows: ParsedSessionRow[];
  fatalError?: string;
}

export function parseSessionSheet(buffer: ArrayBuffer): ParsedSessionSheet {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    return { rows: [], fatalError: "엑셀 파일을 읽지 못했습니다. xlsx 파일인지 확인해주세요." };
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { rows: [], fatalError: "시트를 찾지 못했습니다." };

  const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  if (table.length === 0) return { rows: [], fatalError: "빈 시트입니다." };

  const [header, ...body] = table;
  const headerText = header.map((cell) => String(cell ?? "").trim());
  const headerMatches = SESSION_SHEET_HEADERS.every((expected, i) => headerText[i] === expected);
  if (!headerMatches) {
    return {
      rows: [],
      fatalError: `1행 칼럼이 샘플과 다릅니다. ${SESSION_SHEET_HEADERS.join(", ")} 순서여야 합니다.`
    };
  }

  const dataRows = body.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  const rows: ParsedSessionRow[] = dataRows.map((row, index) => {
    const [, dateRaw, dateEndRaw, timeStartRaw, timeEndRaw, locationRaw, educationDatesRaw] = row;
    const date = normalizeDateCell(dateRaw);
    const dateEnd = normalizeDateCell(dateEndRaw);
    const timeStart = normalizeTimeCell(timeStartRaw);
    const timeEnd = normalizeTimeCell(timeEndRaw);
    const location = String(locationRaw ?? "").trim();
    const educationDatesText = String(educationDatesRaw ?? "").trim();

    const errors: string[] = [];
    if (!date) errors.push("시작일이 비어있습니다.");
    if (!timeStart || !TIME_PATTERN.test(timeStart)) errors.push("시작시간 형식을 확인해주세요 (예: 09:00, 30분 단위).");
    if (!timeEnd || !TIME_PATTERN.test(timeEnd)) errors.push("종료시간 형식을 확인해주세요 (예: 18:00, 30분 단위).");
    if (!location) errors.push("장소가 비어있습니다.");
    if (educationDatesText && parseEducationDatesText(educationDatesText).errors.length > 0) {
      errors.push("실제교육일 형식을 확인해주세요 (예: 2026-09-03, 2026-09-04).");
    }

    return {
      rowNumber: index + 2,
      session: {
        date,
        dateEnd: dateEnd || undefined,
        timeStart,
        timeEnd,
        duration: calcSessionDuration(timeStart, timeEnd),
        location,
        educationDatesText: educationDatesText || undefined
      },
      errors
    };
  });

  return { rows };
}

function normalizeDateCell(raw: unknown): string {
  if (raw == null) return "";
  if (raw instanceof Date) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(raw.getDate()).padStart(2, "0")}`;
  }
  const text = String(raw).trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return text;
}

function normalizeTimeCell(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "number") {
    const totalMinutes = Math.round(raw * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const text = String(raw).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return text;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}
