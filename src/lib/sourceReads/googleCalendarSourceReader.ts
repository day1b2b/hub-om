import { createSign } from "node:crypto";
import { getResourceReadCacheTtlMs, readTimedCache, type TimedCacheEntry } from "@/lib/timedCache";
import { DisabledOperationSourceReader } from "./disabledSourceReader";
import type {
  CalendarResourceEvent,
  CourseBoardRecord,
  DiscussionReference,
  OperationSourceReader,
  SalesRecord,
  SourceReadIssue,
  SourceReadResult
} from "./sourceReadTypes";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars";
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_LOOKAHEAD_DAYS = 60;
const DEFAULT_ABSENCE_KEYWORDS = ["휴가", "연차", "반차", "부재", "휴직", "오프"];

interface GoogleCalendarConfig {
  serviceAccountEmail: string;
  privateKey: string;
  calendars: GoogleCalendarTarget[];
  lookbackDays: number;
  lookaheadDays: number;
  absenceKeywords: string[];
}

interface GoogleCalendarTarget {
  calendarId: string;
  ownerName: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleCalendarEventsResponse {
  items?: GoogleCalendarEvent[];
  error?: {
    code?: number;
    message?: string;
  };
}

interface GoogleCalendarEvent {
  id?: string;
  htmlLink?: string;
  summary?: string;
  start?: {
    date?: string;
    dateTime?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
  };
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
let cachedCalendarRead: TimedCacheEntry<SourceReadResult<CalendarResourceEvent>> | null = null;

export class GoogleCalendarSourceReader implements OperationSourceReader {
  private readonly disabledReader = new DisabledOperationSourceReader();

  constructor(private readonly config = readGoogleCalendarConfig()) {}

  readCourseBoard(): Promise<SourceReadResult<CourseBoardRecord>> {
    return this.disabledReader.readCourseBoard();
  }

  async readCalendarEvents(): Promise<SourceReadResult<CalendarResourceEvent>> {
    const readAt = new Date().toISOString();
    const issues = validateGoogleCalendarConfig(this.config);

    if (issues.length > 0) {
      return {
        source: "calendar",
        status: "failed",
        readAt,
        items: [],
        issues
      };
    }

    const { entry, value } = await readTimedCache(
      cachedCalendarRead,
      getResourceReadCacheTtlMs(),
      () => this.readFreshCalendarEvents()
    );

    cachedCalendarRead = entry;
    return value;
  }

  private async readFreshCalendarEvents(): Promise<SourceReadResult<CalendarResourceEvent>> {
    const readAt = new Date().toISOString();

    try {
      const accessToken = await getGoogleAccessToken(this.config);
      const [timeMin, timeMax] = buildReadWindow(this.config);
      const results = await Promise.all(
        this.config.calendars.map((calendar) => readCalendarEvents(calendar, accessToken, timeMin, timeMax, this.config))
      );

      return {
        source: "calendar",
        status: results.some((result) => result.issues.length > 0) ? "partial" : "ok",
        readAt,
        items: results.flatMap((result) => result.events),
        issues: results.flatMap((result) => result.issues)
      };
    } catch {
      return {
        source: "calendar",
        status: "failed",
        readAt,
        items: [],
        issues: [
          {
            code: "google_calendar_read_failed",
            message: "Google Calendar events could not be read.",
            recoverable: true
          }
        ]
      };
    }
  }

  readDiscussionReferences(): Promise<SourceReadResult<DiscussionReference>> {
    return this.disabledReader.readDiscussionReferences();
  }

  readSalesRecords(): Promise<SourceReadResult<SalesRecord>> {
    return this.disabledReader.readSalesRecords();
  }
}

export function hasGoogleCalendarConfig(): boolean {
  return Boolean(
    process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL ||
      process.env.GOOGLE_CALENDAR_PRIVATE_KEY ||
      process.env.GOOGLE_CALENDAR_IDS
  );
}

function readGoogleCalendarConfig(): GoogleCalendarConfig {
  return {
    serviceAccountEmail: process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL?.trim() ?? "",
    privateKey: normalizePrivateKey(process.env.GOOGLE_CALENDAR_PRIVATE_KEY ?? ""),
    calendars: parseCalendarTargets(process.env.GOOGLE_CALENDAR_IDS ?? ""),
    lookbackDays: parsePositiveInteger(process.env.GOOGLE_CALENDAR_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS),
    lookaheadDays: parsePositiveInteger(process.env.GOOGLE_CALENDAR_LOOKAHEAD_DAYS, DEFAULT_LOOKAHEAD_DAYS),
    absenceKeywords: parseCsv(process.env.GOOGLE_CALENDAR_ABSENCE_KEYWORDS).filter(Boolean)
  };
}

function validateGoogleCalendarConfig(config: GoogleCalendarConfig): SourceReadIssue[] {
  const issues: SourceReadIssue[] = [];

  if (!config.serviceAccountEmail) {
    issues.push(buildConfigIssue("google_calendar_service_account_email_missing"));
  }

  if (!config.privateKey) {
    issues.push(buildConfigIssue("google_calendar_private_key_missing"));
  }

  if (config.calendars.length === 0) {
    issues.push(buildConfigIssue("google_calendar_ids_missing"));
  }

  if (config.calendars.some((calendar) => !calendar.ownerName)) {
    issues.push(buildConfigIssue("google_calendar_owner_name_missing"));
  }

  return issues;
}

function buildConfigIssue(code: string): SourceReadIssue {
  return {
    code,
    message: "Google Calendar reader is not fully configured.",
    recoverable: true
  };
}

async function getGoogleAccessToken(config: GoogleCalendarConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.token;
  }

  const assertion = buildJwtAssertion(config, now);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const payload = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error ?? "google_token_request_failed");
  }

  cachedAccessToken = {
    token: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600)
  };

  return payload.access_token;
}

function buildJwtAssertion(config: GoogleCalendarConfig, now: number): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: config.serviceAccountEmail,
      scope: GOOGLE_CALENDAR_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: now + 3600,
      iat: now
    })
  );
  const signatureInput = `${header}.${claimSet}`;
  const signature = createSign("RSA-SHA256").update(signatureInput).sign(config.privateKey);

  return `${signatureInput}.${base64UrlEncode(signature)}`;
}

async function readCalendarEvents(
  calendar: GoogleCalendarTarget,
  accessToken: string,
  timeMin: string,
  timeMax: string,
  config: GoogleCalendarConfig
): Promise<{ events: CalendarResourceEvent[]; issues: SourceReadIssue[] }> {
  const url = new URL(`${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(calendar.calendarId)}/events`);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("maxResults", "2500");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const payload = (await response.json()) as GoogleCalendarEventsResponse;

  if (!response.ok) {
    return {
      events: [],
      issues: [
        {
          code: "google_calendar_events_read_failed",
          message: formatCalendarReadError(response.status, payload.error?.message, calendar.ownerName),
          recoverable: true
        }
      ]
    };
  }

  return {
    events: (payload.items ?? []).map((event) => mapCalendarEvent(event, calendar, config)),
    issues: []
  };
}

function mapCalendarEvent(
  event: GoogleCalendarEvent,
  calendar: GoogleCalendarTarget,
  config: GoogleCalendarConfig
): CalendarResourceEvent {
  const title = event.summary?.trim() || "제목 없음";

  return {
    sourceEventId: event.id ?? `${calendar.ownerName}-${event.start?.dateTime ?? event.start?.date ?? title}`,
    ownerName: calendar.ownerName,
    title,
    startDateTime: event.start?.dateTime ?? event.start?.date ?? "",
    endDateTime: event.end?.dateTime ?? event.end?.date ?? "",
    eventKind: inferEventKind(title, config.absenceKeywords),
    sourceUrl: event.htmlLink
  };
}

function inferEventKind(title: string, configuredKeywords: string[]): CalendarResourceEvent["eventKind"] {
  const keywords = configuredKeywords.length > 0 ? configuredKeywords : DEFAULT_ABSENCE_KEYWORDS;
  const normalizedTitle = title.toLowerCase();
  const isAbsence = keywords.some((keyword) => normalizedTitle.includes(keyword.toLowerCase()));

  return isAbsence ? "absence" : "class";
}

function formatCalendarReadError(status: number, message: string | undefined, ownerName: string): string {
  if (process.env.NODE_ENV === "production") {
    return "A configured Google Calendar could not be read.";
  }

  return `Google Calendar read failed for ${ownerName || "configured calendar"}: HTTP ${status}${
    message ? ` - ${message}` : ""
  }`;
}

function buildReadWindow(config: GoogleCalendarConfig): [string, string] {
  const min = new Date();
  min.setDate(min.getDate() - config.lookbackDays);
  min.setHours(0, 0, 0, 0);

  const max = new Date();
  max.setDate(max.getDate() + config.lookaheadDays);
  max.setHours(23, 59, 59, 999);

  return [min.toISOString(), max.toISOString()];
}

function normalizePrivateKey(value: string): string {
  return value.trim().replace(/\\n/g, "\n");
}

function parseCalendarTargets(value: string): GoogleCalendarTarget[] {
  return parseCsv(value)
    .map((entry) => {
      const [calendarId = "", ownerName = ""] = entry.split("|").map((part) => part.trim());
      return { calendarId, ownerName };
    })
    .filter((calendar) => calendar.calendarId);
}

function parseCsv(value = ""): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
