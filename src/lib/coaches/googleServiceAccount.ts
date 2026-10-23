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
export type GoogleSheetFailureKind = "missing_credentials" | "auth_failed" | "forbidden" | "not_found" | "bad_range" | "http";

export class GoogleSheetReadError extends Error {
  readonly kind: GoogleSheetFailureKind;
  readonly status: number | null;
  readonly code: string | null;
  constructor(kind: GoogleSheetFailureKind, message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = "GoogleSheetReadError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function sheetHttpError(source: string, status: number, body: string): GoogleSheetReadError {
  let googleStatus: string | null = null, googleMessage = "";
  try {
    const parsed = JSON.parse(body) as { error?: { status?: unknown; message?: unknown } };
    googleStatus = typeof parsed.error?.status === "string" ? parsed.error.status : null;
    googleMessage = typeof parsed.error?.message === "string" ? parsed.error.message : "";
  } catch { /* 본문이 JSON이 아니면 상태 코드로만 판단한다. */ }
  const message = `${source} failed (${status})`;
  if (status === 401) return new GoogleSheetReadError("auth_failed", message, status, googleStatus);
  if (status === 403) return new GoogleSheetReadError("forbidden", message, status, googleStatus);
  if (status === 404) return new GoogleSheetReadError("not_found", message, status, googleStatus);
  if (status === 400 && /parse range/i.test(googleMessage)) return new GoogleSheetReadError("bad_range", message, status, googleStatus);
  return new GoogleSheetReadError("http", message, status, googleStatus);
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
  assertGoogleConfig(config);
  const token = await getGoogleAccessToken(config);
  const url = `${GOOGLE_SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 400 && /Office file/.test(text)) {
      return readOfficeSpreadsheetRows(spreadsheetId, range, token);
    }
    throw sheetHttpError("Google Sheets read", response.status, text);
  }

  const payload = (await response.json()) as { values?: string[][] };
  return { values: payload.values ?? [], struckCells: new Set() };
}

async function readOfficeSpreadsheetRows(fileId: string, range: string, token: string): Promise<SpreadsheetRows> {
  const response = await fetch(`${GOOGLE_DRIVE_URL}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    throw sheetHttpError("Google Drive file download", response.status, await response.text());
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
