import { createSign } from "node:crypto";
import type { OperationSession } from "@/lib/data/operationTypes";
import type {
  DiscussionReference,
  SourceReadIssue,
  SourceReadResult
} from "./sourceReadTypes";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users";
const DEFAULT_MAX_RESULTS = 8;

interface GmailDiscussionConfig {
  serviceAccountEmail: string;
  privateKey: string;
  impersonateUser: string;
  afterDate: string;
  maxResults: number;
  teamGroups: Map<string, string[]>;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface GmailMessageListResponse {
  messages?: Array<{
    id?: string;
    threadId?: string;
  }>;
  error?: {
    code?: number;
    message?: string;
  };
}

interface GmailMessageResponse {
  id?: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
  };
  error?: {
    code?: number;
    message?: string;
  };
}

interface GmailHeader {
  name?: string;
  value?: string;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export function hasGmailDiscussionConfig(): boolean {
  const config = readGmailDiscussionConfig();

  return Boolean(config.serviceAccountEmail && config.privateKey && config.impersonateUser);
}

export async function readGmailOperationDiscussionReferences(
  operation: OperationSession
): Promise<SourceReadResult<DiscussionReference>> {
  const readAt = new Date().toISOString();
  const config = readGmailDiscussionConfig();
  const issues = validateGmailDiscussionConfig(config);

  if (issues.length > 0) {
    return {
      source: "discussion",
      status: "failed",
      readAt,
      items: [],
      issues
    };
  }

  try {
    const accessToken = await getGoogleAccessToken(config);
    const messages = await listGmailMessages(config, operation, accessToken);
    const uniqueMessages = dedupeGmailThreadMessages(messages);
    const metadata = await Promise.all(
      uniqueMessages.map((message) => readGmailMessageMetadata(config, message.id, accessToken))
    );

    return {
      source: "discussion",
      status: "ok",
      readAt,
      items: metadata.map((message) => mapGmailMessage(message, operation)),
      issues: []
    };
  } catch {
    return {
      source: "discussion",
      status: "failed",
      readAt,
      items: [],
      issues: [
        {
          code: "gmail_discussion_read_failed",
          message: "Gmail discussion messages could not be read.",
          recoverable: true
        }
      ]
    };
  }
}

function readGmailDiscussionConfig(): GmailDiscussionConfig {
  return {
    serviceAccountEmail:
      process.env.GMAIL_SERVICE_ACCOUNT_EMAIL?.trim() ||
      process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL?.trim() ||
      process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL?.trim() ||
      "",
    privateKey: normalizePrivateKey(
      process.env.GMAIL_PRIVATE_KEY ||
        process.env.GOOGLE_DRIVE_PRIVATE_KEY ||
        process.env.GOOGLE_CALENDAR_PRIVATE_KEY ||
        ""
    ),
    impersonateUser: process.env.GMAIL_IMPERSONATE_USER?.trim() ?? "",
    afterDate: normalizeGmailDate(process.env.GMAIL_DISCUSSION_AFTER_DATE ?? ""),
    maxResults: parsePositiveInteger(process.env.GMAIL_DISCUSSION_MAX_RESULTS, DEFAULT_MAX_RESULTS),
    teamGroups: parseTeamGroups(process.env.GMAIL_DISCUSSION_TEAM_GROUPS ?? "")
  };
}

function validateGmailDiscussionConfig(config: GmailDiscussionConfig): SourceReadIssue[] {
  const issues: SourceReadIssue[] = [];

  if (!config.serviceAccountEmail) {
    issues.push(buildConfigIssue("gmail_service_account_email_missing"));
  }

  if (!config.privateKey) {
    issues.push(buildConfigIssue("gmail_private_key_missing"));
  }

  if (!config.impersonateUser) {
    issues.push(buildConfigIssue("gmail_impersonate_user_missing"));
  }

  return issues;
}

function buildConfigIssue(code: string): SourceReadIssue {
  return {
    code,
    message: "Gmail reader is not fully configured.",
    recoverable: true
  };
}

async function getGoogleAccessToken(config: GmailDiscussionConfig): Promise<string> {
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

function buildJwtAssertion(config: GmailDiscussionConfig, now: number): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: config.serviceAccountEmail,
      sub: config.impersonateUser,
      scope: GMAIL_READONLY_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: now + 3600,
      iat: now
    })
  );
  const signatureInput = `${header}.${claimSet}`;
  const signature = createSign("RSA-SHA256").update(signatureInput).sign(config.privateKey);

  return `${signatureInput}.${base64UrlEncode(signature)}`;
}

async function listGmailMessages(
  config: GmailDiscussionConfig,
  operation: OperationSession,
  accessToken: string
): Promise<Array<{ id: string; threadId?: string }>> {
  const url = new URL(`${GMAIL_MESSAGES_URL}/${encodeURIComponent(config.impersonateUser)}/messages`);
  url.searchParams.set("q", buildGmailSearchQuery(config, operation));
  url.searchParams.set("maxResults", String(config.maxResults));

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const payload = (await response.json()) as GmailMessageListResponse;

  if (!response.ok) {
    throw new Error(`gmail_messages_list_failed:${response.status}`);
  }

  return (payload.messages ?? [])
    .map((message) => ({
      id: message.id ?? "",
      threadId: message.threadId
    }))
    .filter((message) => message.id);
}

async function readGmailMessageMetadata(
  config: GmailDiscussionConfig,
  messageId: string,
  accessToken: string
): Promise<GmailMessageResponse> {
  const url = new URL(
    `${GMAIL_MESSAGES_URL}/${encodeURIComponent(config.impersonateUser)}/messages/${encodeURIComponent(messageId)}`
  );
  url.searchParams.set("format", "metadata");

  for (const header of ["Subject", "From", "Date", "Message-ID"]) {
    url.searchParams.append("metadataHeaders", header);
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const payload = (await response.json()) as GmailMessageResponse;

  if (!response.ok || !payload.id) {
    throw new Error(`gmail_message_get_failed:${response.status}`);
  }

  return payload;
}

function mapGmailMessage(
  message: GmailMessageResponse,
  operation: OperationSession
): DiscussionReference {
  const subject = headerValue(message, "Subject") || "제목 없는 메일";
  const from = summarizeSender(headerValue(message, "From"));
  const snippet = truncateText(cleanupSnippet(message.snippet ?? ""), 96);
  const senderText = from ? `발신 ${from}` : "발신자 확인 필요";
  const summary = truncateText([subject, senderText, snippet].filter(Boolean).join(" · "), 160);

  return {
    sourceKind: "email",
    sourceLabel: "메일",
    sourceMessageId: `gmail:${message.id ?? message.threadId ?? subject}`,
    operationKey: [
      `operationId:${operation.operationId}`,
      `courseId:${operation.courseId}`,
      operation.companyName,
      operation.courseName
    ].filter(Boolean).join(" "),
    title: subject,
    occurredAt: occurredAtFromMessage(message),
    sourceUrl: buildGmailMessageUrl(message),
    summary
  };
}

function buildGmailSearchQuery(config: GmailDiscussionConfig, operation: OperationSession) {
  const afterDate = config.afterDate || normalizeGmailDate(monthOffsetDate(operation.startDate, -3));
  const groupFilter = buildTeamGroupFilter(config, operation);
  const terms = [
    operation.operationId,
    operation.courseId,
    operation.companyName,
    operation.courseName,
    operation.om,
    operation.ld
  ]
    .map(formatGmailSearchTerm)
    .filter(Boolean);

  return [
    afterDate ? `after:${afterDate}` : "",
    groupFilter,
    terms.length > 0 ? `(${terms.join(" OR ")})` : ""
  ].filter(Boolean).join(" ");
}

function buildTeamGroupFilter(config: GmailDiscussionConfig, operation: OperationSession) {
  const sourceTeam = operation.sourceTeam ?? "";
  const groups = config.teamGroups.get(sourceTeam) ?? [];
  const groupTerms = groups.flatMap((group) => [
    `to:${group}`,
    `cc:${group}`,
    `deliveredto:${group}`,
    `list:${group}`
  ]);

  return groupTerms.length > 0 ? `(${groupTerms.join(" OR ")})` : "";
}

function formatGmailSearchTerm(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return `"${trimmed.replace(/"/g, " ")}"`;
}

function dedupeGmailThreadMessages(messages: Array<{ id: string; threadId?: string }>) {
  const seen = new Set<string>();
  const deduped: Array<{ id: string; threadId?: string }> = [];

  for (const message of messages) {
    const key = message.threadId ?? message.id;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(message);
  }

  return deduped;
}

function buildGmailMessageUrl(message: GmailMessageResponse) {
  const rfcMessageId = cleanupRfcMessageId(headerValue(message, "Message-ID"));

  if (rfcMessageId) {
    return `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(rfcMessageId)}`;
  }

  const threadOrMessageId = message.threadId ?? message.id ?? "";
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadOrMessageId)}`;
}

function occurredAtFromMessage(message: GmailMessageResponse) {
  const internalDate = Number(message.internalDate);

  if (Number.isFinite(internalDate) && internalDate > 0) {
    return new Date(internalDate).toISOString();
  }

  const dateHeader = headerValue(message, "Date");
  const parsedDate = new Date(dateHeader);

  return Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
}

function headerValue(message: GmailMessageResponse, name: string) {
  return message.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

function summarizeSender(value: string) {
  return truncateText(
    value
      .replace(/<[^>]+>/g, "")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
      .replace(/["']/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    40
  );
}

function cleanupSnippet(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupRfcMessageId(value: string) {
  return value.replace(/[<>]/g, "").trim();
}

function normalizePrivateKey(value: string): string {
  return value.trim().replace(/\\n/g, "\n");
}

function parseTeamGroups(value: string) {
  const groups = new Map<string, string[]>();

  for (const entry of value.split(",")) {
    const [team, rawReferences] = splitTeamGroupEntry(entry);
    const references = rawReferences
      .split("|")
      .map(groupReferenceToEmail)
      .filter(Boolean);

    if (team && references.length > 0) {
      groups.set(team, references);
    }
  }

  return groups;
}

function splitTeamGroupEntry(value: string): [string, string] {
  const separatorIndex = value.indexOf(":");

  if (separatorIndex < 0) {
    return ["", ""];
  }

  return [
    value.slice(0, separatorIndex).trim(),
    value.slice(separatorIndex + 1).trim()
  ];
}

function groupReferenceToEmail(value: string) {
  const trimmed = value.trim();

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return trimmed;
  }

  const googleGroupMatch = trimmed.match(/groups\.google\.com\/a\/([^/]+)\/g\/([^/?#]+)/i);

  if (googleGroupMatch) {
    return `${decodeURIComponent(googleGroupMatch[2])}@${googleGroupMatch[1]}`;
  }

  return "";
}

function normalizeGmailDate(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const parsedDate = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed);

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return [
    parsedDate.getUTCFullYear(),
    String(parsedDate.getUTCMonth() + 1).padStart(2, "0"),
    String(parsedDate.getUTCDate()).padStart(2, "0")
  ].join("/");
}

function monthOffsetDate(value: string, monthOffset: number) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setUTCMonth(date.getUTCMonth() + monthOffset);
  return date.toISOString().slice(0, 10);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
