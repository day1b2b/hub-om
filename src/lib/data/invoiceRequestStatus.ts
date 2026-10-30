import { GoogleSheetReadError, readGoogleSheetValues } from "../coaches/googleServiceAccount";
import { normalizeCourseId } from "./operationCalculations";

// 계산서 발행 요청 구글폼의 응답 시트(전사 공통)에서 "이 코스ID로 요청이 들어왔는지"만 읽는다.
// 시트에는 사업자번호·금액 같은 민감 정보가 같이 있어서, 헤더 행과 타임스탬프·코스ID 열만 따로
// 요청한다(나머지 열은 서버로도 가져오지 않는다). 시트 ID는 저장소가 public이라 env로만 받는다.
const DEFAULT_TAB = "설문지 응답 시트(전사_공통)";
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface InvoiceRequestStatus {
  /** 가장 최근 요청의 타임스탬프 원문(시트 표기 그대로, 예: "2025. 1. 9 오전 9:28:35"). */
  lastRequestedAt: string;
  requestCount: number;
}

export type InvoiceRequestStatusResult =
  | { ok: true; byCourseId: Map<string, InvoiceRequestStatus> }
  | { ok: false; reason: "not_configured" | "read_failed" | "unexpected_header" };

let cache: { expiresAt: number; result: InvoiceRequestStatusResult } | null = null;

export function readInvoiceRequestSheetConfig(): { spreadsheetId: string; tab: string } {
  return {
    spreadsheetId: process.env.INVOICE_REQUEST_SHEET_ID?.trim() ?? "",
    tab: process.env.INVOICE_REQUEST_SHEET_TAB?.trim() || DEFAULT_TAB
  };
}

/** 응답 시트를 코스ID별 요청 현황으로 바꾼다. 실패해도 예외를 던지지 않는다 — 링크 화면은 계속 떠야 한다. */
export async function loadInvoiceRequestStatuses(now = Date.now()): Promise<InvoiceRequestStatusResult> {
  if (cache && cache.expiresAt > now) return cache.result;

  const result = await readStatuses();
  // 설정 누락은 env가 바뀌기 전까지 그대로라 캐시해도 되고, 읽기 실패도 매 상세 열기마다
  // 구글을 다시 두드리지 않도록 같은 시간만큼 캐시한다.
  cache = { expiresAt: now + CACHE_TTL_MS, result };
  return result;
}

/** 테스트용. */
export function resetInvoiceRequestStatusCache(): void {
  cache = null;
}

async function readStatuses(): Promise<InvoiceRequestStatusResult> {
  const { spreadsheetId, tab } = readInvoiceRequestSheetConfig();
  if (!spreadsheetId) return { ok: false, reason: "not_configured" };

  const sheet = `'${tab.replaceAll("'", "''")}'`;
  try {
    const [header = []] = await readGoogleSheetValues(spreadsheetId, `${sheet}!1:1`);
    const columns = findColumns(header);
    if (!columns) return { ok: false, reason: "unexpected_header" };

    const [timestamps, courseIds] = await Promise.all([
      readGoogleSheetValues(spreadsheetId, `${sheet}!${columns.timestamp}:${columns.timestamp}`),
      readGoogleSheetValues(spreadsheetId, `${sheet}!${columns.courseId}:${columns.courseId}`)
    ]);
    return { ok: true, byCourseId: summarizeRequests(timestamps.slice(1), courseIds.slice(1)) };
  } catch (error) {
    // 시트 내용·토큰은 남기지 않고 실패 종류만 남긴다.
    console.error("[invoice-request-status] SHEET_READ_FAILED", {
      kind: error instanceof GoogleSheetReadError ? error.kind : "unknown",
      status: error instanceof GoogleSheetReadError ? error.status : null
    });
    return { ok: false, reason: "read_failed" };
  }
}

/** 헤더 문구가 길고 줄바꿈이 섞여 있어(예: "코스ID\n\n(★ 백오피스 코스 ID를…") 앞부분으로 찾는다. */
export function findColumns(header: string[]): { courseId: string; timestamp: string } | null {
  const indexOf = (prefix: string) => header.findIndex((cell) => (cell ?? "").replace(/\s+/g, "").startsWith(prefix));
  const timestamp = indexOf("타임스탬프");
  const courseId = indexOf("코스ID");
  if (timestamp < 0 || courseId < 0) return null;
  return { courseId: columnLetter(courseId), timestamp: columnLetter(timestamp) };
}

export function columnLetter(index: number): string {
  let letter = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
  return letter;
}

/** 폼 응답은 시간순으로 쌓이므로 같은 코스ID의 마지막 행이 가장 최근 요청이다. */
export function summarizeRequests(timestamps: string[][], courseIds: string[][]): Map<string, InvoiceRequestStatus> {
  const byCourseId = new Map<string, InvoiceRequestStatus>();
  courseIds.forEach((row, index) => {
    const courseId = normalizeCourseId(row?.[0]);
    if (!courseId) return;
    const previous = byCourseId.get(courseId);
    byCourseId.set(courseId, {
      lastRequestedAt: (timestamps[index]?.[0] ?? "").trim() || previous?.lastRequestedAt || "",
      requestCount: (previous?.requestCount ?? 0) + 1
    });
  });
  return byCourseId;
}
