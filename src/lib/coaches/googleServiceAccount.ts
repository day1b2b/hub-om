import { createSign } from "node:crypto";
import { readXlsxRows, type SpreadsheetRows } from "./xlsxReader";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_DRIVE_URL = "https://www.googleapis.com/drive/v3/files";

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  expires_in?: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * 구글 시트 읽기 실패의 종류. 응답 본문은 시트 내용이 섞일 수 있어 담지 않고,
 * 원인을 가르는 데 필요한 상태 코드와 구글 오류 코드(예: invalid_grant)만 남긴다.
 */
export type GoogleSheetFailureKind = "missing_credentials" | "auth_failed" | "scope_missing" | "forbidden" | "not_found" | "bad_range" | "http";

/** 시트를 어떤 계정으로 읽었는지. 권한 안내 문구가 달라진다. */
export type GoogleSheetAccess = "service_account" | "b2b";

export class GoogleSheetReadError extends Error {
  readonly kind: GoogleSheetFailureKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly via: GoogleSheetAccess | null;
  constructor(kind: GoogleSheetFailureKind, message: string, status: number | null = null, code: string | null = null, via: GoogleSheetAccess | null = null) {
    super(message);
    this.name = "GoogleSheetReadError";
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.via = via;
  }
}

export function sheetHttpError(source: string, status: number, body: string, via: GoogleSheetAccess | null = null): GoogleSheetReadError {
  let googleStatus: string | null = null, googleMessage = "";
  try {
    const parsed = JSON.parse(body) as { error?: { status?: unknown; message?: unknown } };
    googleStatus = typeof parsed.error?.status === "string" ? parsed.error.status : null;
    googleMessage = typeof parsed.error?.message === "string" ? parsed.error.message : "";
  } catch { /* 본문이 JSON이 아니면 상태 코드로만 판단한다. */ }
  const message = `${source} failed (${status})`;
  const error = (kind: GoogleSheetFailureKind) => new GoogleSheetReadError(kind, message, status, googleStatus, via);
  if (status === 401) return error("auth_failed");
  // 토큰은 유효하지만 시트 권한(spreadsheets.readonly)에 동의받지 않은 경우. 공유 문제와 구분한다.
  if (status === 403 && /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(`${googleMessage} ${body}`)) return error("scope_missing");
  if (status === 403) return error("forbidden");
  if (status === 404) return error("not_found");
  if (status === 400 && /parse range/i.test(googleMessage)) return error("bad_range");
  return error("http");
}

export interface GoogleServiceAccountConfig {
  privateKey: string;
  serviceAccountEmail: string;
}

export function readGoogleServiceAccountConfig(): GoogleServiceAccountConfig {
  return {
    serviceAccountEmail:
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() ||
      process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL?.trim() ||
      process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL?.trim() ||
      "",
    privateKey: normalizePrivateKey(
      process.env.GOOGLE_PRIVATE_KEY ||
        process.env.GOOGLE_DRIVE_PRIVATE_KEY ||
        process.env.GOOGLE_CALENDAR_PRIVATE_KEY ||
        ""
    )
  };
}

export function assertGoogleConfig(config: GoogleServiceAccountConfig): void {
  if (!config.serviceAccountEmail) throw new GoogleSheetReadError("missing_credentials", "Google service account email env가 필요합니다.");
  if (!config.privateKey) throw new GoogleSheetReadError("missing_credentials", "Google private key env가 필요합니다.");
}

export async function readGoogleSheetValues(
  spreadsheetId: string,
  range: string,
  config = readGoogleServiceAccountConfig()
): Promise<string[][]> {
  return (await readGoogleSpreadsheetRows(spreadsheetId, range, config)).values;
}

export async function readGoogleSpreadsheetRows(
  spreadsheetId: string,
  range: string,
  config = readGoogleServiceAccountConfig()
): Promise<SpreadsheetRows> {
  const { token, via } = await resolveSheetAccessToken(config);
  const url = `${GOOGLE_SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 400 && /Office file/.test(text)) {
      return readOfficeSpreadsheetRows(spreadsheetId, range, token, via);
    }
    throw sheetHttpError("Google Sheets read", response.status, text, via);
  }

  const payload = (await response.json()) as { values?: string[][] };
  return { values: payload.values ?? [], struckCells: new Set() };
}

/**
 * 시트를 읽을 토큰. 서비스 계정이 설정돼 있으면 그것을 쓰고, 없으면 캘린더·만족도 시트와 같은
 * B2B 공용 계정 OAuth 토큰(GOOGLE_CAL_OAUTH_*)을 쓴다. 회사 조직 정책이 서비스 계정 키 생성을
 * 막고 있어 운영에는 서비스 계정이 없다(2026-10-23 확인). 둘 다 없으면 설정 누락으로 멈춘다.
 */
async function resolveSheetAccessToken(config: GoogleServiceAccountConfig): Promise<{ token: string; via: GoogleSheetAccess }> {
  if (config.serviceAccountEmail && config.privateKey) {
    return { token: await getGoogleAccessToken(config), via: "service_account" };
  }
  const { readCalendarWriteCredentials } = await import("../googleCalendar/calendarWriteConfig");
  if (!readCalendarWriteCredentials()) {
    throw new GoogleSheetReadError("missing_credentials", "Google service account or B2B OAuth env가 필요합니다.");
  }
  const { getGoogleB2BAccessToken } = await import("../googleCalendar/calendarWriteClient");
  try {
    return { token: await getGoogleB2BAccessToken(), via: "b2b" };
  } catch {
    // 토큰·응답 본문은 남기지 않는다.
    throw new GoogleSheetReadError("auth_failed", "Google B2B token refresh failed", null, "b2b_token_refresh_failed", "b2b");
  }
}

async function readOfficeSpreadsheetRows(fileId: string, range: string, token: string, via: GoogleSheetAccess): Promise<SpreadsheetRows> {
  const response = await fetch(`${GOOGLE_DRIVE_URL}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    throw sheetHttpError("Google Drive file download", response.status, await response.text(), via);
  }

  return readXlsxRows(Buffer.from(await response.arrayBuffer()), range);
}

async function getGoogleAccessToken(config: GoogleServiceAccountConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  let assertion: string;
  try {
    assertion = buildJwtAssertion(config, now);
  } catch {
    // 개인 키 형식이 잘못되면 서명 단계에서 실패한다. 키 내용은 메시지에 넣지 않는다.
    throw new GoogleSheetReadError("auth_failed", "Google private key could not sign", null, "invalid_private_key");
  }
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    const code = typeof payload.error === "string" ? payload.error : null;
    throw new GoogleSheetReadError("auth_failed", code ?? "Google token request failed", response.status, code);
  }

  cachedToken = { token: payload.access_token, expiresAt: now + (payload.expires_in ?? 3600) };
  return cachedToken.token;
}

function buildJwtAssertion(config: GoogleServiceAccountConfig, now: number): string {
  const scope = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly"
  ].join(" ");
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlEncode(
    JSON.stringify({
      iss: config.serviceAccountEmail,
      scope,
      aud: GOOGLE_TOKEN_URL,
      exp: now + 3600,
      iat: now
    })
  );
  const input = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(input).sign(config.privateKey);
  return `${input}.${base64UrlEncode(signature)}`;
}

function normalizePrivateKey(value: string): string {
  const trimmed = value.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  return unquoted.replace(/\\n/g, "\n");
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
