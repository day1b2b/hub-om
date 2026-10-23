import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSheetReadError, readGoogleSpreadsheetRows, sheetHttpError } from "./googleServiceAccount";
import { resetAccessTokenCache } from "../googleCalendar/calendarWriteClient";

const googleError = (status: string, message: string) => JSON.stringify({ error: { code: 400, status, message } });

test("sheet HTTP failures are classified by status and Google error, without keeping the body", () => {
  const rangeBody = googleError("INVALID_ARGUMENT", "Unable to parse range: '조교실습코치_일반계약요청'!A:Q");
  const cases: Array<[number, string, string]> = [
    [401, googleError("UNAUTHENTICATED", "Request had invalid authentication credentials."), "auth_failed"],
    [403, googleError("PERMISSION_DENIED", "Request had insufficient authentication scopes."), "scope_missing"],
    [403, googleError("PERMISSION_DENIED", "The caller does not have permission"), "forbidden"],
    [404, googleError("NOT_FOUND", "Requested entity was not found."), "not_found"],
    [400, rangeBody, "bad_range"],
    [400, googleError("INVALID_ARGUMENT", "Something else"), "http"],
    [500, "<html>private sheet body</html>", "http"]
  ];
  for (const [status, body, kind] of cases) {
    const error = sheetHttpError("Google Sheets read", status, body, "b2b");
    assert.ok(error instanceof GoogleSheetReadError);
    assert.equal(error.kind, kind);
    assert.equal(error.status, status);
    assert.equal(error.via, "b2b");
    assert.equal(error.message, `Google Sheets read failed (${status})`);
    assert.doesNotMatch(error.message, /private sheet body|parse range|scopes/);
  }
  assert.equal(sheetHttpError("Google Sheets read", 403, googleError("PERMISSION_DENIED", "x")).code, "PERMISSION_DENIED");
  assert.equal(sheetHttpError("Google Sheets read", 500, "not json").code, null);
});

const SHEET_ENV = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY", "GOOGLE_DRIVE_PRIVATE_KEY", "GOOGLE_CALENDAR_PRIVATE_KEY",
  "GOOGLE_CAL_OAUTH_CLIENT_ID", "GOOGLE_CAL_OAUTH_CLIENT_SECRET", "GOOGLE_CAL_OAUTH_REFRESH_TOKEN"
] as const;

async function withSheetEnv(values: Partial<Record<(typeof SHEET_ENV)[number], string>>, work: () => Promise<void>) {
  const saved = Object.fromEntries(SHEET_ENV.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  for (const name of SHEET_ENV) delete process.env[name];
  Object.assign(process.env, values);
  resetAccessTokenCache();
  try { await work(); }
  finally {
    globalThis.fetch = originalFetch;
    for (const name of SHEET_ENV) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    resetAccessTokenCache();
  }
}

test("without a service account the B2B OAuth token reads the sheet", async () => {
  await withSheetEnv({ GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-id", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-secret", GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-refresh" }, async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "synthetic-b2b-token", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ values: [["header"], ["row"]] }), { status: 200 });
    }) as typeof fetch;
    const rows = await readGoogleSpreadsheetRows("synthetic-sheet", "'Tab'!A:B");
    assert.deepEqual(rows.values, [["header"], ["row"]]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].authorization, "Bearer synthetic-b2b-token");
  });
});

test("B2B failures keep the access path so the message can name the B2B account", async () => {
  await withSheetEnv({ GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-id", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-secret", GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-refresh" }, async () => {
    globalThis.fetch = (async (input: string | URL | Request) => String(input).startsWith("https://oauth2.googleapis.com/token")
      ? new Response(JSON.stringify({ access_token: "synthetic-b2b-token" }), { status: 200 })
      : new Response(googleError("PERMISSION_DENIED", "Request had insufficient authentication scopes."), { status: 403 })) as typeof fetch;
    await assert.rejects(readGoogleSpreadsheetRows("synthetic-sheet", "'Tab'!A:B"), (error: unknown) =>
      error instanceof GoogleSheetReadError && error.kind === "scope_missing" && error.via === "b2b");
  });
  await withSheetEnv({ GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-id", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-secret", GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-refresh" }, async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch;
    await assert.rejects(readGoogleSpreadsheetRows("synthetic-sheet", "'Tab'!A:B"), (error: unknown) =>
      error instanceof GoogleSheetReadError && error.kind === "auth_failed" && error.via === "b2b");
  });
});

test("with neither account configured the read stops before any network call", async () => {
  await withSheetEnv({}, async () => {
    let fetched = 0;
    globalThis.fetch = (async () => { fetched++; return new Response("{}"); }) as typeof fetch;
    await assert.rejects(readGoogleSpreadsheetRows("synthetic-sheet", "'Tab'!A:B"), (error: unknown) =>
      error instanceof GoogleSheetReadError && error.kind === "missing_credentials");
    assert.equal(fetched, 0);
  });
});
