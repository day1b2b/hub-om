import { GoogleSheetReadError, readGoogleSheetValues } from "../coaches/googleServiceAccount";
import { normalizeCourseId } from "./operationCalculations";

// 계산서 발행 요청 구글폼의 응답 시트(전사 공통)에서 "이 코스ID로 요청이 들어왔는지"와 재무팀이 채우는
// 처리 결과(발급여부·발급일자·실제입금일자)를 읽는다. 시트에는 사업자번호·금액 같은 민감 정보가 같이 있어서,
// 헤더 행과 이 다섯 열만 따로 요청한다(나머지 열은 서버로도 가져오지 않는다). 시트 ID는 저장소가 public이라 env로만 받는다.
//
// 시트가 회사 도메인 안에서만 공유돼 있어 서버의 구글 계정(외부 gmail)으로는 못 읽는다. 그래서 회사 계정으로
// 배포한 Apps Script 웹앱(INVOICE_REQUEST_STATUS_URL)이 있으면 그쪽에서 다섯 열만 받아 온다 — 웹앱 코드는
// docs/operations/invoice-request-status-webapp.gs. 웹앱 URL·토큰도 env로만 받는다. 없으면 기존처럼 시트를 직접 읽는다.
const DEFAULT_TAB = "설문지 응답 시트(전사_공통)";
const CACHE_TTL_MS = 5 * 60 * 1000;
const WEBAPP_TIMEOUT_MS = 20 * 1000;

export interface InvoiceRequestStatus {
  /** 가장 최근 요청의 타임스탬프 원문(시트 표기 그대로, 예: "2025. 1. 9 오전 9:28:35"). */
  lastRequestedAt: string;
  requestCount: number;
  /** 가장 최근 요청 행의 "발급여부"(예: "발급완료"). 재무팀이 아직 처리 전이면 빈 문자열. */
  issueStatus: string;
  /** 가장 최근 요청 행의 "발급일자" 원문. */
  issuedAt: string;
  /** 가장 최근 요청 행의 "실제입금일자" 원문(메모가 섞여 있을 수 있다, 예: "2025.03.31 (합산 입금)"). */
  paidAt: string;
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

export function readInvoiceRequestWebAppConfig(): { url: string; token: string } {
  return {
    url: process.env.INVOICE_REQUEST_STATUS_URL?.trim() ?? "",
    token: process.env.INVOICE_REQUEST_STATUS_TOKEN?.trim() ?? ""
  };
}

async function readStatuses(): Promise<InvoiceRequestStatusResult> {
  const webApp = readInvoiceRequestWebAppConfig();
  if (webApp.url) return readStatusesFromWebApp(webApp);

  const { spreadsheetId, tab } = readInvoiceRequestSheetConfig();
  if (!spreadsheetId) return { ok: false, reason: "not_configured" };

  const sheet = `'${tab.replaceAll("'", "''")}'`;
  try {
    const [header = []] = await readGoogleSheetValues(spreadsheetId, `${sheet}!1:1`);
    const columns = findColumns(header);
    if (!columns) return { ok: false, reason: "unexpected_header" };

    const readColumn = async (letter: string | null) =>
      letter ? (await readGoogleSheetValues(spreadsheetId, `${sheet}!${letter}:${letter}`)).slice(1) : [];
    const [timestamps, courseIds, issueStatuses, issuedAts, paidAts] = await Promise.all([
      readColumn(columns.timestamp),
      readColumn(columns.courseId),
      readColumn(columns.issueStatus),
      readColumn(columns.issuedAt),
      readColumn(columns.paidAt)
    ]);
    return { ok: true, byCourseId: summarizeRequests({ timestamps, courseIds, issueStatuses, issuedAts, paidAts }) };
  } catch (error) {
    // 시트 내용·토큰은 남기지 않고 실패 종류만 남긴다.
    console.error("[invoice-request-status] SHEET_READ_FAILED", {
      kind: error instanceof GoogleSheetReadError ? error.kind : "unknown",
      status: error instanceof GoogleSheetReadError ? error.status : null
    });
    return { ok: false, reason: "read_failed" };
  }
}

/**
 * 웹앱은 { ok: true, rows: [[타임스탬프, 코스ID, 발급여부, 발급일자, 실제입금일자], ...] }(헤더 제외)를 돌려준다.
 * 토큰은 URL에 남지 않게 POST 본문으로 보낸다. Apps Script는 응답 코드를 못 바꿔 실패도 200 + ok:false로 온다.
 */
async function readStatusesFromWebApp({ url, token }: { url: string; token: string }): Promise<InvoiceRequestStatusResult> {
  if (!token) return { ok: false, reason: "not_configured" };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token }),
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(WEBAPP_TIMEOUT_MS)
    });
    const body: unknown = response.ok ? await response.json().catch(() => null) : null;
    const byCourseId = parseWebAppRows(body);
    if (!byCourseId) {
      const error = (body as { error?: unknown } | null)?.error;
      // 웹앱 응답 내용은 남기지 않고 상태 코드·실패 종류만 남긴다.
      console.error("[invoice-request-status] WEBAPP_READ_FAILED", {
        status: response.status,
        error: typeof error === "string" ? error.slice(0, 40) : null
      });
      return { ok: false, reason: error === "unexpected_header" ? "unexpected_header" : "read_failed" };
    }
    return { ok: true, byCourseId };
  } catch (error) {
    console.error("[invoice-request-status] WEBAPP_READ_FAILED", { kind: error instanceof Error ? error.name : "unknown" });
    return { ok: false, reason: "read_failed" };
  }
}

/** 웹앱 응답을 코스ID별 현황으로. 모양이 다르면 null(→ 화면 "확인 불가"). */
export function parseWebAppRows(body: unknown): Map<string, InvoiceRequestStatus> | null {
  if (!body || typeof body !== "object") return null;
  const { ok, rows } = body as { ok?: unknown; rows?: unknown };
  if (ok !== true || !Array.isArray(rows)) return null;
  const column = (index: number) => rows.map((row) => [Array.isArray(row) ? String(row[index] ?? "") : ""]);
  return summarizeRequests({
    timestamps: column(0),
    courseIds: column(1),
    issueStatuses: column(2),
    issuedAts: column(3),
    paidAts: column(4)
  });
}

export interface InvoiceRequestColumns {
  courseId: string;
  timestamp: string;
  /** 처리 결과 열은 없을 수도 있다(헤더가 바뀌면) — 그땐 요청 여부만 보여 준다. */
  issueStatus: string | null;
  issuedAt: string | null;
  paidAt: string | null;
}

/** 헤더 문구가 길고 줄바꿈이 섞여 있어(예: "코스ID\n\n(★ 백오피스 코스 ID를…") 앞부분으로 찾는다. */
export function findColumns(header: string[]): InvoiceRequestColumns | null {
  const indexOf = (prefix: string) => header.findIndex((cell) => (cell ?? "").replace(/\s+/g, "").startsWith(prefix));
  const optional = (prefix: string) => {
    const index = indexOf(prefix);
    return index < 0 ? null : columnLetter(index);
  };
  const timestamp = indexOf("타임스탬프");
  const courseId = indexOf("코스ID");
  if (timestamp < 0 || courseId < 0) return null;
  return {
    courseId: columnLetter(courseId),
    timestamp: columnLetter(timestamp),
    issueStatus: optional("발급여부"),
    issuedAt: optional("발급일자"),
    paidAt: optional("실제입금일자")
  };
}

export function columnLetter(index: number): string {
  let letter = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
  return letter;
}

/**
 * 폼 응답은 시간순으로 쌓이므로 같은 코스ID의 마지막 행이 가장 최근 요청이다.
 * 처리 결과(발급여부·발급일자·실제입금일자)도 그 최근 행 값을 쓴다 — 취소 후 다시 요청한 건이면 다시 낸 요청 기준이다.
 * 각 열은 헤더를 뺀 행 배열(시트 API는 열마다 끝 빈 행을 잘라 길이가 다를 수 있다).
 */
export function summarizeRequests(columns: {
  timestamps: string[][];
  courseIds: string[][];
  issueStatuses?: string[][];
  issuedAts?: string[][];
  paidAts?: string[][];
}): Map<string, InvoiceRequestStatus> {
  const cell = (rows: string[][] | undefined, index: number) => (rows?.[index]?.[0] ?? "").trim();
  const byCourseId = new Map<string, InvoiceRequestStatus>();
  columns.courseIds.forEach((row, index) => {
    const courseId = normalizeCourseId(row?.[0]);
    if (!courseId) return;
    const previous = byCourseId.get(courseId);
    byCourseId.set(courseId, {
      lastRequestedAt: cell(columns.timestamps, index) || previous?.lastRequestedAt || "",
      requestCount: (previous?.requestCount ?? 0) + 1,
      issueStatus: cell(columns.issueStatuses, index),
      issuedAt: cell(columns.issuedAts, index),
      paidAt: cell(columns.paidAts, index)
    });
  });
  return byCourseId;
}
