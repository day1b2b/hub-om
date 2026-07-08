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
const DEFAULT_MAX_RESULTS = 25;
const GMAIL_DISCUSSION_BUSINESS_TERMS = [
  "문의",
  "제안",
  "계약",
  "계산서",
  "견적",
  "서명",
  "미팅",
  "일정",
  "준비",
  "전달",
  "교안",
  "강의",
  "모니터링",
  "피드백",
  "LMS",
  "보안",
  "협조",
  "안내",
  "첨부",
  "출강",
  "요청"
];

interface GmailDiscussionConfig {
  oauthAccessToken?: string;
  serviceAccountEmail: string;
  privateKey: string;
  impersonateUser: string;
  afterDate: string;
  manualArchiveUntilDate: string;
  maxResults: number;
  teamGroups: Map<string, string[]>;
}

export interface GmailDiscussionReadOptions {
  oauthAccessToken?: string;
}

export interface GmailDiscussionReadPlan {
  liveGmailEnabled: boolean;
  liveGmailSearchAfterDate: string;
  manualArchiveEnabled: boolean;
  manualArchiveUntilDate: string;
  searchTermKinds: string[];
  sourceTeam: string;
  teamGroupFilterEnabled: boolean;
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
  payload?: GmailMessagePayload;
  error?: {
    code?: number;
    message?: string;
  };
}

interface GmailMessagePayload {
  body?: {
    data?: string;
  };
  filename?: string;
  headers?: GmailHeader[];
  mimeType?: string;
  parts?: GmailMessagePayload[];
}

interface GmailThreadResponse {
  id?: string;
  messages?: GmailMessageResponse[];
  snippet?: string;
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

export function hasGmailDiscussionConfig(options: GmailDiscussionReadOptions = {}): boolean {
  const config = readGmailDiscussionConfig(options);

  return Boolean(config.oauthAccessToken || (config.serviceAccountEmail && config.privateKey && config.impersonateUser));
}

export function buildGmailDiscussionReadPlan(
  operation: OperationSession,
  options: GmailDiscussionReadOptions = {}
): GmailDiscussionReadPlan {
  const config = readGmailDiscussionConfig(options);

  return {
    liveGmailEnabled: hasGmailDiscussionConfig(options),
    liveGmailSearchAfterDate: resolveGmailSearchAfterDate(config, operation),
    manualArchiveEnabled: Boolean(process.env.GMAIL_DISCUSSION_MANUAL_ARCHIVE_FILE?.trim()),
    manualArchiveUntilDate: config.manualArchiveUntilDate,
    searchTermKinds: ["operationId", "courseId", "companyName", "courseName", "om", "ld"],
    sourceTeam: operation.sourceTeam ?? "미분류",
    teamGroupFilterEnabled: getTeamGroups(config, operation).length > 0
  };
}

export async function readGmailOperationDiscussionReferences(
  operation: OperationSession,
  options: GmailDiscussionReadOptions = {}
): Promise<SourceReadResult<DiscussionReference>> {
  const readAt = new Date().toISOString();
  const config = readGmailDiscussionConfig(options);
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
    console.info(`[sourceReads:gmail] candidates=${uniqueMessages.length}`);
    const threads = await Promise.all(
      uniqueMessages.map((message) => readGmailThreadMetadata(config, message, accessToken))
    );

    return {
      source: "discussion",
      status: "ok",
      readAt,
      items: threads.map(mapGmailThread),
      issues: []
    };
  } catch (error) {
    const issueCode = gmailReadIssueCode(error);
    console.warn(`[sourceReads:gmail] ${issueCode}`);

    return {
      source: "discussion",
      status: "failed",
      readAt,
      items: [],
      issues: [
        {
          code: issueCode,
          message: "Gmail discussion messages could not be read.",
          recoverable: true
        }
      ]
    };
  }
}

function gmailReadIssueCode(error: unknown) {
  if (!(error instanceof Error)) {
    return "gmail_discussion_read_failed";
  }

  if (error.message.startsWith("gmail_messages_list_failed:")) {
    return `gmail_messages_list_failed_${error.message.split(":")[1] ?? "unknown"}`;
  }

  if (error.message.startsWith("gmail_message_get_failed:")) {
    return `gmail_message_get_failed_${error.message.split(":")[1] ?? "unknown"}`;
  }

  if (error.message === "google_token_request_failed") {
    return "gmail_token_request_failed";
  }

  return "gmail_discussion_read_failed";
}

function readGmailDiscussionConfig(options: GmailDiscussionReadOptions = {}): GmailDiscussionConfig {
  return {
    oauthAccessToken: options.oauthAccessToken,
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
    manualArchiveUntilDate: normalizeGmailDate(process.env.GMAIL_DISCUSSION_MANUAL_ARCHIVE_UNTIL_DATE ?? ""),
    maxResults: parsePositiveInteger(process.env.GMAIL_DISCUSSION_MAX_RESULTS, DEFAULT_MAX_RESULTS),
    teamGroups: parseTeamGroups(process.env.GMAIL_DISCUSSION_TEAM_GROUPS ?? "")
  };
}

function validateGmailDiscussionConfig(config: GmailDiscussionConfig): SourceReadIssue[] {
  const issues: SourceReadIssue[] = [];

  if (config.oauthAccessToken) {
    return issues;
  }

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
  if (config.oauthAccessToken) {
    return config.oauthAccessToken;
  }

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
  const queries = buildGmailSearchQueries(config, operation);
  const messageLists = await Promise.all(queries.map((query) => listGmailMessagesByQuery(config, query, accessToken)));

  return messageLists.flat();
}

async function listGmailMessagesByQuery(
  config: GmailDiscussionConfig,
  query: string,
  accessToken: string
): Promise<Array<{ id: string; threadId?: string }>> {
  const url = new URL(`${GMAIL_MESSAGES_URL}/${encodeURIComponent(gmailUserId(config))}/messages`);
  url.searchParams.set("q", query);
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

async function readGmailThreadMetadata(
  config: GmailDiscussionConfig,
  message: { id: string; threadId?: string },
  accessToken: string
): Promise<GmailThreadResponse> {
  const threadId = message.threadId ?? message.id;
  const url = new URL(
    `${GMAIL_MESSAGES_URL}/${encodeURIComponent(gmailUserId(config))}/threads/${encodeURIComponent(threadId)}`
  );
  url.searchParams.set("format", "full");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const payload = (await response.json()) as GmailThreadResponse;

  if (!response.ok || !payload.id) {
    throw new Error(`gmail_message_get_failed:${response.status}`);
  }

  return payload;
}

function gmailUserId(config: GmailDiscussionConfig) {
  return config.oauthAccessToken ? "me" : config.impersonateUser;
}

function mapGmailThread(thread: GmailThreadResponse): DiscussionReference {
  const messages = [...(thread.messages ?? [])].sort((a, b) => occurredAtFromMessage(a).localeCompare(occurredAtFromMessage(b)));
  const latestMessage = messages[messages.length - 1];
  const firstMessage = messages[0];
  const subject = headerValue(latestMessage ?? firstMessage, "Subject") || "제목 없는 메일";
  const bodyPreview = cleanupSnippet(extractGmailMessageText(latestMessage));
  const snippet = truncateText(bodyPreview || cleanupSnippet(latestMessage?.snippet ?? thread.snippet ?? ""), 900);
  const summary = buildGmailThreadSummary(snippet);

  return {
    sourceKind: "email",
    sourceLabel: "메일",
    sourceMessageId: `gmail-thread:${thread.id ?? latestMessage?.threadId ?? latestMessage?.id ?? subject}`,
    operationKey: `gmail:${thread.id ?? latestMessage?.threadId ?? latestMessage?.id ?? ""}`,
    title: subject,
    occurredAt: latestMessage ? occurredAtFromMessage(latestMessage) : new Date().toISOString(),
    sourceUrl: buildGmailThreadUrl(thread, latestMessage),
    summary
  };
}

function buildGmailThreadSummary(snippet: string) {
  return truncateText(`요약: ${summarizeGmailOperationalContent(snippet)}`, 190);
}

function summarizeGmailOperationalContent(snippet: string) {
  const keyPoints = extractGmailKeyPoints(snippet);

  if (keyPoints.length === 0) {
    return "요약할 핵심 내용 확인 필요";
  }

  return keyPoints.join(" / ");
}

function extractGmailKeyPoints(snippet: string) {
  const strategicPoints = extractGmailStrategicKeyPoints(snippet);

  if (strategicPoints.length > 0) {
    return strategicPoints;
  }

  const keyPoints = splitGmailSnippetSentences(snippet)
    .map(compactGmailSentence)
    .filter((sentence) => sentence.length >= 6)
    .filter((sentence) => !isGmailMetadataText(sentence))
    .filter(isOperationalGmailSentence);
  const nonAttachmentPoints = keyPoints.filter((sentence) => !isAttachmentOnlyGmailSentence(sentence));

  return (nonAttachmentPoints.length > 0 ? nonAttachmentPoints : keyPoints).slice(0, 2);
}

function extractGmailStrategicKeyPoints(snippet: string) {
  const lines = splitGmailSnippetLines(snippet);
  const numberedTopics = lines
    .map((line, index) => ({ index, match: line.match(/^\d+[.)]\s*(.+)$/) }))
    .filter((entry): entry is { index: number; match: RegExpMatchArray } => Boolean(entry.match))
    .map((entry) => {
      const title = compactGmailSentence(entry.match[1] ?? "");
      const detail = compactGmailSentence(lines[entry.index + 1] ?? "");

      return detail && !isAttachmentOnlyGmailSentence(detail) ? `${title}: ${detail}` : title;
    })
    .filter((point) => point.length >= 3)
    .slice(0, 2);

  if (numberedTopics.length > 0 && hasAnyGmailKeyword(snippet.toLowerCase(), ["강의 방향", "달라진 점", "변경", "보강", "사례", "데모"])) {
    return [`강의 방향 ${numberedTopics.join(" / ")}`];
  }

  const directionLine = lines
    .map(compactGmailSentence)
    .find((line) => hasAnyGmailKeyword(line.toLowerCase(), ["강의 방향", "달라진 점", "기술공유 사례", "데모", "insight", "활용 방안"]));

  return directionLine ? [directionLine] : [];
}

function splitGmailSnippetLines(value: string) {
  return value
    .split(/\n+|--+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !isGmailBoilerplateLine(line));
}

function splitGmailSnippetSentences(value: string) {
  return value
    .split(/\n+|(?<=[.!?。])\s+|(?<=다[.])\s+|(?<=요[.])\s+|(?<=니다[.])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function compactGmailSentence(value: string) {
  return value
    .replace(/^(보낸\s*사람|받는\s*사람|수신|참조|제목|날짜|일시)\s*:\s*.+$/i, "")
    .replace(/^(안녕하세요|안녕하십니까)[,.!\s]+/i, "")
    .replace(/(확인하였습니다|확인했습니다)/g, "확인")
    .replace(/(검토 후 회신드리도록 하겠습니다|검토 후 회신드리겠습니다|검토 후 회신 예정입니다|검토 후 회신 예정)/g, "검토 후 회신 예정")
    .replace(/(전달드립니다|전달드리겠습니다|전달 드립니다)/g, "전달")
    .replace(/(첨부하여 전달드립니다|첨부 전달드립니다|첨부드립니다)/g, "첨부 전달")
    .replace(/(부탁드립니다|부탁 드립니다)/g, "요청")
    .replace(/[.!?。]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isOperationalGmailSentence(value: string) {
  return hasAnyGmailKeyword(value.toLowerCase(), [
    "계약",
    "계산서",
    "견적",
    "서명",
    "발행",
    "비용",
    "정산",
    "환급",
    "검토",
    "회신",
    "미작성",
    "작성하지",
    "일정",
    "미팅",
    "교안",
    "첨부",
    "전달",
    "모니터링",
    "피드백",
    "만족도",
    "요청",
    "협조",
    "확인"
  ]);
}

function isAttachmentOnlyGmailSentence(value: string) {
  const text = value.toLowerCase();

  return hasAnyGmailKeyword(text, ["교안", "첨부", "전달", "pdf", "ppt", "docx"]) &&
    !hasAnyGmailKeyword(text, ["강의 방향", "달라진 점", "사례", "데모", "insight", "활용 방안", "피드백", "검토"]);
}

function isGmailBoilerplateLine(value: string) {
  return isGmailMetadataText(value) ||
    /^(안녕하세요|안녕하십니까|감사합니다|좋은\s*아침입니다|첨부\s*>|첨부파일|내부적으로\s*확인)/i.test(value);
}

function isGmailMetadataText(value: string) {
  const compacted = value.replace(/\s+/g, " ").trim();

  if (/^(보낸\s*사람|받는\s*사람|수신|참조|제목|날짜|일시)\s*:/i.test(compacted)) {
    return true;
  }

  if (/(보낸\s*사람|받는\s*사람|수신|참조)\s*:/i.test(compacted) && /<[^>]+@[^>]+>/.test(compacted)) {
    return true;
  }

  const emailMatches = compacted.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  return emailMatches.length >= 2;
}

function hasAnyGmailKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function buildGmailSearchQueries(config: GmailDiscussionConfig, operation: OperationSession) {
  const afterDate = resolveGmailSearchAfterDate(config, operation);
  const beforeDate = resolveGmailSearchBeforeDate(operation);
  const groupFilter = buildTeamGroupFilter(config, operation);
  const companyTerms = buildGmailSearchTerms(operation.companyName);
  const courseTerms = [
    operation.operationId,
    operation.courseId,
    operation.courseName
  ].flatMap(buildGmailSearchTerms);
  const peopleTerms = [
    operation.om,
    operation.ld
  ].flatMap(buildGmailSearchTerms);
  const businessTerms = GMAIL_DISCUSSION_BUSINESS_TERMS.map(formatGmailSearchTerm);
  const dateFilter = [
    afterDate ? `after:${afterDate}` : "",
    beforeDate ? `before:${beforeDate}` : ""
  ].filter(Boolean).join(" ");
  const queries = [
    [dateFilter, groupFilter, joinOrTerms(companyTerms)],
    [dateFilter, groupFilter, joinOrTerms(companyTerms), joinOrTerms(businessTerms)],
    [dateFilter, groupFilter, joinOrTerms(companyTerms), joinOrTerms(peopleTerms)],
    [dateFilter, groupFilter, joinOrTerms(companyTerms), joinOrTerms(courseTerms)],
    [dateFilter, joinOrTerms(companyTerms)],
    [dateFilter, joinOrTerms(peopleTerms), joinOrTerms(courseTerms)]
  ]
    .map((parts) => parts.filter(Boolean).join(" "))
    .filter(Boolean);

  return [...new Set(queries)];
}

function buildTeamGroupFilter(config: GmailDiscussionConfig, operation: OperationSession) {
  const groups = getTeamGroups(config, operation);
  const groupTerms = groups.flatMap((group) => [
    `to:${group}`,
    `cc:${group}`,
    `deliveredto:${group}`,
    `list:${group}`
  ]);

  return groupTerms.length > 0 ? `(${groupTerms.join(" OR ")})` : "";
}

function getTeamGroups(config: GmailDiscussionConfig, operation: OperationSession) {
  return config.teamGroups.get(operation.sourceTeam ?? "") ?? [];
}

function resolveGmailSearchAfterDate(config: GmailDiscussionConfig, operation: OperationSession) {
  return (
    config.afterDate ||
    nextGmailDate(config.manualArchiveUntilDate) ||
    normalizeGmailDate(monthOffsetDate(operation.startDate, -3))
  );
}

function resolveGmailSearchBeforeDate(operation: OperationSession) {
  return normalizeGmailDate(monthOffsetDate(operation.endDate, 2));
}

function formatGmailSearchTerm(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return `"${trimmed.replace(/"/g, " ")}"`;
}

function buildGmailSearchTerms(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  return [
    trimmed,
    trimmed.replace(/\s+/g, "")
  ]
    .filter((term, index, terms) => term.length >= 2 && terms.indexOf(term) === index)
    .map(formatGmailSearchTerm)
    .filter(Boolean);
}

function joinOrTerms(terms: string[]) {
  const uniqueTerms = [...new Set(terms)].filter(Boolean);

  if (uniqueTerms.length === 0) {
    return "";
  }

  return uniqueTerms.length === 1 ? uniqueTerms[0] : `(${uniqueTerms.join(" OR ")})`;
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

function buildGmailThreadUrl(thread: GmailThreadResponse, latestMessage: GmailMessageResponse | undefined) {
  const rfcMessageId = cleanupRfcMessageId(headerValue(latestMessage, "Message-ID"));

  if (rfcMessageId) {
    return `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(rfcMessageId)}`;
  }

  const threadOrMessageId = thread.id ?? latestMessage?.threadId ?? latestMessage?.id ?? "";
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

function headerValue(message: GmailMessageResponse | undefined, name: string) {
  return message?.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

function extractGmailMessageText(message: GmailMessageResponse | undefined) {
  if (!message?.payload) {
    return "";
  }

  const plainText = collectGmailPayloadText(message.payload, "text/plain");
  const htmlText = plainText ? "" : collectGmailPayloadText(message.payload, "text/html");
  const text = plainText || stripHtmlText(htmlText);

  return truncateText(removeQuotedMailHistory(text), 2000);
}

function collectGmailPayloadText(payload: GmailMessagePayload, preferredMimeType: string): string {
  const chunks: string[] = [];

  collectGmailPayloadTextChunks(payload, preferredMimeType, chunks);

  return chunks.join("\n").trim();
}

function collectGmailPayloadTextChunks(payload: GmailMessagePayload, preferredMimeType: string, chunks: string[]) {
  if (payload.mimeType === preferredMimeType && payload.body?.data) {
    chunks.push(decodeGmailBodyData(payload.body.data));
  }

  for (const part of payload.parts ?? []) {
    collectGmailPayloadTextChunks(part, preferredMimeType, chunks);
  }
}

function decodeGmailBodyData(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function stripHtmlText(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function removeQuotedMailHistory(value: string) {
  let current = value;

  for (const separator of [
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nOn .+ wrote:/i,
    /\n보낸 사람\s*:/,
    /\nFrom\s*:/i
  ]) {
    current = current.split(separator)[0] ?? "";
  }

  return current;
}

function cleanupSnippet(value: string) {
  return removeMailBoilerplate(removeGmailMetadataBlock(value))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function removeMailBoilerplate(value: string) {
  return value
    .replace(/^(안녕하세요|안녕하십니까)[,.\s]+[^.?!\n]{0,90}(입니다|드립니다)[.?!]\s*/i, "")
    .replace(/안녕하세요[.!?]?\s*[^.?!\n]{0,40}패스트캠퍼스\s*[^\s.?!\n]{0,20}(입니다|드립니다)[.!?]?\s*/gi, "")
    .replace(/안녕하세요[.!?]?\s*[^.?!\n]{0,40}(대리님|매니저님|팀장님|강사님|책임님|님)[.!?]?\s*/gi, "")
    .replace(/패스트캠퍼스\s*[^\s.?!\n]{0,20}(입니다|드립니다)[.!?]?\s*/gi, "")
    .replace(/감사합니다[.!?]?\s*/gi, "")
    .replace(/확인\s*부탁드립니다[.!?]?\s*/gi, "");
}

function removeGmailMetadataBlock(value: string) {
  return value
    .replace(/(?:^|\n)\s*(보낸\s*사람|받는\s*사람|수신|참조|제목|날짜|일시)\s*:\s*[^\n]*(?=\n|$)/gi, "\n")
    .replace(/^(?:\s*(보낸\s*사람|받는\s*사람|수신|참조|제목|날짜|일시)\s*:\s*[^:]{0,240})+/i, "");
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

function nextGmailDate(value: string) {
  if (!value) {
    return "";
  }

  const parsedDate = new Date(`${value.replaceAll("/", "-")}T00:00:00.000Z`);

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  parsedDate.setUTCDate(parsedDate.getUTCDate() + 1);

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
