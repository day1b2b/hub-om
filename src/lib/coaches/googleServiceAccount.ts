import { createSign } from "node:crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  expires_in?: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

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
  if (!config.serviceAccountEmail) throw new Error("Google service account email env가 필요합니다.");
  if (!config.privateKey) throw new Error("Google private key env가 필요합니다.");
}

export async function readGoogleSheetValues(
  spreadsheetId: string,
  range: string,
  config = readGoogleServiceAccountConfig()
): Promise<string[][]> {
  assertGoogleConfig(config);
  const token = await getGoogleAccessToken(config);
  const url = `${GOOGLE_SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    throw new Error(`Google Sheets read failed (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as { values?: string[][] };
  return payload.values ?? [];
}

async function getGoogleAccessToken(config: GoogleServiceAccountConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  const assertion = buildJwtAssertion(config, now);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const payload = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error ?? "Google token request failed");
  }

  cachedToken = { token: payload.access_token, expiresAt: now + (payload.expires_in ?? 3600) };
  return cachedToken.token;
}

function buildJwtAssertion(config: GoogleServiceAccountConfig, now: number): string {
  const scope = "https://www.googleapis.com/auth/spreadsheets.readonly";
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
  return value.trim().replace(/\\n/g, "\n");
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
