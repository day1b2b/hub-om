import type { OperationSession } from "@/lib/data/operationTypes";
import { getOperationSourceReader } from "@/lib/sourceReads";
import {
  hasGmailDiscussionConfig,
  readGmailOperationDiscussionReferences
} from "@/lib/sourceReads/gmailDiscussionReader";
import {
  hasManualEmailDiscussionArchiveConfig,
  readManualEmailOperationDiscussionReferences
} from "@/lib/sourceReads/manualEmailDiscussionArchiveReader";
import {
  hasSlackDiscussionConfig,
  readSlackOperationDiscussionReferences,
  readSlackOperationReportReferences
} from "@/lib/sourceReads/slackDiscussionReader";
import { getResourceReadCacheTtlMs, readTimedCache, type TimedCacheEntry } from "@/lib/timedCache";
import type {
  DiscussionReference,
  DiscussionReferenceSourceKind,
  SourceReadIssue,
  SourceReadResult,
  SourceReadStatus
} from "@/lib/sourceReads";

export interface OperationDiscussionItem {
  id: string;
  occurredAt: string;
  sourceKind: DiscussionReferenceSourceKind;
  sourceLabel: string;
  sourceUrl: string;
  summary?: string;
  title: string;
}

export interface OperationEmailCandidateItem extends OperationDiscussionItem {
  matched: boolean;
}

export interface OperationChangeHistoryItem {
  detail: string;
  id: string;
  occurredAt: string;
  sourceUrl?: string;
  title: string;
}

export interface OperationCollaboration {
  changeHistory: OperationChangeHistoryItem[];
  changeHistoryStatus: SourceReadStatus;
  discussionDiagnostics: OperationDiscussionDiagnostics;
  discussionEmailCandidates: OperationEmailCandidateItem[];
  discussionIssues: SourceReadIssue[];
  discussionReferences: OperationDiscussionItem[];
  discussionSourceAvailability: OperationDiscussionSourceAvailability;
  discussionStatus: SourceReadStatus;
  lectureReports: OperationDiscussionItem[];
  lectureReportStatus: SourceReadStatus;
}

export interface OperationDiscussionSourceAvailability {
  emailEnabled: boolean;
  slackEnabled: boolean;
}

export interface OperationDiscussionDiagnostics {
  emailCandidateCount: number;
  emailMatchedCount: number;
}

export interface OperationCollaborationReadOptions {
  gmailOAuthAccessToken?: string;
  /**
   * 요청을 보낸 사용자의 검증된 세션 이메일(NextAuth `signIn`에서 워크스페이스 도메인 검증을 거친 값).
   * OAuth 경로의 Gmail 캐시를 사용자별로 분리하는 데만 쓰인다 — 클라이언트가 임의로 지정한 값이 아니다.
   */
  requestUserEmail?: string;
}

export type OperationDiscussionRefreshSource = "all" | "email" | "slack";

const MAX_DISCUSSION_ITEMS = 16;

interface OperationCollaborationCacheState {
  genericDiscussionCacheEntry: TimedCacheEntry<SourceReadResult<DiscussionReference>> | null;
  gmailDiscussionCache: Map<string, TimedCacheEntry<SourceReadResult<DiscussionReference>>>;
  manualEmailDiscussionCache: Map<string, TimedCacheEntry<SourceReadResult<DiscussionReference>>>;
  operationReportCache: Map<string, TimedCacheEntry<SourceReadResult<DiscussionReference>>>;
  slackDiscussionCache: Map<string, TimedCacheEntry<SourceReadResult<DiscussionReference>>>;
}

declare global {
  var __hubOmOperationCollaborationCacheState: OperationCollaborationCacheState | undefined;
}

const operationCollaborationCacheState = globalThis.__hubOmOperationCollaborationCacheState ??= {
  genericDiscussionCacheEntry: null,
  gmailDiscussionCache: new Map<string, TimedCacheEntry<SourceReadResult<DiscussionReference>>>(),
  manualEmailDiscussionCache: new Map<string, TimedCacheEntry<SourceReadResult<DiscussionReference>>>(),
  operationReportCache: new Map<string, TimedCacheEntry<SourceReadResult<DiscussionReference>>>(),
  slackDiscussionCache: new Map<string, TimedCacheEntry<SourceReadResult<DiscussionReference>>>()
};
const gmailDiscussionCache = operationCollaborationCacheState.gmailDiscussionCache;
const manualEmailDiscussionCache = operationCollaborationCacheState.manualEmailDiscussionCache;
const operationReportCache = operationCollaborationCacheState.operationReportCache;
const slackDiscussionCache = operationCollaborationCacheState.slackDiscussionCache;

export async function readOperationCollaboration(
  operation: OperationSession,
  options: OperationCollaborationReadOptions = {}
): Promise<OperationCollaboration> {
  const [discussionResult, reportResult] = await Promise.all([
    readOperationDiscussions(operation, options),
    readOperationReports(operation)
  ]);

  return {
    changeHistory: [],
    changeHistoryStatus: "disabled",
    discussionDiagnostics: discussionResult.diagnostics,
    discussionEmailCandidates: discussionResult.emailCandidates,
    discussionIssues: discussionResult.issues,
    discussionReferences: discussionResult.items,
    discussionSourceAvailability: discussionResult.availability,
    discussionStatus: discussionResult.status,
    lectureReports: reportResult.items,
    lectureReportStatus: reportResult.status
  };
}

export interface ClearOperationDiscussionCacheOptions {
  /**
   * 지정하면 이 사용자 본인의 Gmail OAuth 캐시(+공용 서비스 계정 캐시)만 지운다.
   * 생략하면(관리자/전체 무효화 용도) 해당 과정의 모든 사용자 Gmail 캐시를 지운다.
   */
  requestUserEmail?: string;
}

export function clearOperationDiscussionCache(
  operationId: string,
  source: OperationDiscussionRefreshSource,
  options: ClearOperationDiscussionCacheOptions = {}
) {
  if (source === "all" || source === "slack") {
    slackDiscussionCache.delete(operationId);
    operationReportCache.delete(operationId);
  }

  if (source === "all" || source === "email") {
    manualEmailDiscussionCache.delete(operationId);
    clearGmailDiscussionCache(operationId, options.requestUserEmail);
  }

  if (source === "all") {
    operationCollaborationCacheState.genericDiscussionCacheEntry = null;
  }
}

function clearGmailDiscussionCache(operationId: string, requestUserEmail?: string) {
  gmailDiscussionCache.delete(buildGmailServiceAccountCacheKey(operationId));

  const userKey = normalizeGmailCacheUserKey(requestUserEmail);

  if (userKey) {
    gmailDiscussionCache.delete(buildGmailOAuthCacheKey(operationId, userKey));
    return;
  }

  const oauthPrefix = buildGmailOAuthCacheKeyPrefix(operationId);

  for (const key of gmailDiscussionCache.keys()) {
    if (key.startsWith(oauthPrefix)) {
      gmailDiscussionCache.delete(key);
    }
  }
}

async function readOperationDiscussions(operation: OperationSession, options: OperationCollaborationReadOptions) {
  const availability = {
    emailEnabled: hasGmailDiscussionConfig({ oauthAccessToken: options.gmailOAuthAccessToken }) || hasManualEmailDiscussionArchiveConfig(),
    slackEnabled: hasSlackDiscussionConfig()
  };

  try {
    const sourceResults = availability.slackEnabled || availability.emailEnabled
      ? await Promise.all(buildDiscussionSourceReads(operation, availability, options))
      : [await readGenericDiscussionCache()];
    const mergedResult = mergeDiscussionSourceResults(sourceResults);
    const emailCandidateReferences = mergedResult.items.filter((item) => inferDiscussionSourceKind(item) === "email");
    const emailCandidateCount = emailCandidateReferences.length;
    const matchedReferences = mergedResult.items.filter((item) => matchesOperationDiscussion(item, operation));
    const matchedReferenceIds = new Set(matchedReferences.map((item) => item.sourceMessageId));
    const emailMatchedCount = matchedReferences.filter((item) => inferDiscussionSourceKind(item) === "email").length;
    const emailCandidates = emailCandidateReferences
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .map((item) => ({
        ...toOperationDiscussionItem(item),
        matched: matchedReferenceIds.has(item.sourceMessageId)
      }));
    const matchedItems = matchedReferences
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, MAX_DISCUSSION_ITEMS)
      .map(toOperationDiscussionItem);

    if (availability.emailEnabled) {
      console.info(`[operationCollaboration] emailCandidates=${emailCandidateCount} emailMatched=${emailMatchedCount}`);
    }

    return {
      availability,
      diagnostics: {
        emailCandidateCount,
        emailMatchedCount
      },
      emailCandidates,
      issues: mergedResult.issues,
      items: matchedItems,
      status: mergedResult.status
    };
  } catch (error) {
    return {
      availability,
      diagnostics: {
        emailCandidateCount: 0,
        emailMatchedCount: 0
      },
      emailCandidates: [],
      issues: [
        {
          code: "discussion_read_failed",
          message: error instanceof Error ? error.message : "Discussion references could not be read.",
          recoverable: true
        }
      ],
      items: [],
      status: "failed" as const
    };
  }
}

function buildDiscussionSourceReads(
  operation: OperationSession,
  availability: OperationDiscussionSourceAvailability,
  options: OperationCollaborationReadOptions
): Array<Promise<SourceReadResult<DiscussionReference>>> {
  const reads: Array<Promise<SourceReadResult<DiscussionReference>>> = [];

  if (availability.slackEnabled) {
    reads.push(readDiscussionSourceResult("slack", () => readSlackOperationSpecificDiscussionCache(operation)));
  }

  if (availability.emailEnabled) {
    if (hasManualEmailDiscussionArchiveConfig()) {
      reads.push(readDiscussionSourceResult("manual_email", () => readManualEmailOperationSpecificDiscussionCache(operation)));
    }

    if (hasGmailDiscussionConfig({ oauthAccessToken: options.gmailOAuthAccessToken })) {
      reads.push(readDiscussionSourceResult("gmail", () => readGmailOperationSpecificDiscussionCache(operation, options)));
    }
  }

  return reads;
}

async function readDiscussionSourceResult(
  sourceCode: "gmail" | "manual_email" | "slack",
  read: () => Promise<SourceReadResult<DiscussionReference>>
): Promise<SourceReadResult<DiscussionReference>> {
  try {
    return await read();
  } catch {
    return {
      source: "discussion",
      status: "failed",
      readAt: new Date().toISOString(),
      items: [],
      issues: [
        {
          code: `${sourceCode}_discussion_read_failed`,
          message: `${sourceCode} discussion references could not be read.`,
          recoverable: true
        }
      ]
    };
  }
}

function readSlackOperationSpecificDiscussionCache(operation: OperationSession) {
  const cacheKey = operation.operationId;

  return readTimedCache(slackDiscussionCache.get(cacheKey) ?? null, getResourceReadCacheTtlMs(), () =>
    readSlackOperationDiscussionReferences(operation)
  ).then((cached) => {
    slackDiscussionCache.set(cacheKey, cached.entry);
    return cached.value;
  });
}

function readGmailOperationSpecificDiscussionCache(operation: OperationSession, options: OperationCollaborationReadOptions) {
  const read = () => readGmailOperationDiscussionReferences(operation, { oauthAccessToken: options.gmailOAuthAccessToken });

  if (!options.gmailOAuthAccessToken) {
    const cacheKey = buildGmailServiceAccountCacheKey(operation.operationId);

    return readTimedCache(gmailDiscussionCache.get(cacheKey) ?? null, getResourceReadCacheTtlMs(), read).then((cached) => {
      gmailDiscussionCache.set(cacheKey, cached.entry);
      return cached.value;
    });
  }

  const userKey = normalizeGmailCacheUserKey(options.requestUserEmail);

  if (!userKey) {
    // 신원이 확인되지 않은 OAuth 요청은 다른 사용자와 공유되는 캐시에 절대 넣지 않고 매번 새로 읽는다.
    return read();
  }

  const cacheKey = buildGmailOAuthCacheKey(operation.operationId, userKey);

  return readTimedCache(gmailDiscussionCache.get(cacheKey) ?? null, getResourceReadCacheTtlMs(), read).then((cached) => {
    gmailDiscussionCache.set(cacheKey, cached.entry);
    return cached.value;
  });
}

function buildGmailServiceAccountCacheKey(operationId: string) {
  return `${operationId}:service-account`;
}

function buildGmailOAuthCacheKeyPrefix(operationId: string) {
  return `${operationId}:oauth:`;
}

function buildGmailOAuthCacheKey(operationId: string, userKey: string) {
  return `${buildGmailOAuthCacheKeyPrefix(operationId)}${userKey}`;
}

function normalizeGmailCacheUserKey(email: string | undefined) {
  return email?.trim().toLowerCase() || "";
}

function readManualEmailOperationSpecificDiscussionCache(operation: OperationSession) {
  const cacheKey = operation.operationId;

  return readTimedCache(manualEmailDiscussionCache.get(cacheKey) ?? null, getResourceReadCacheTtlMs(), () =>
    readManualEmailOperationDiscussionReferences()
  ).then((cached) => {
    manualEmailDiscussionCache.set(cacheKey, cached.entry);
    return cached.value;
  });
}

async function readOperationReports(operation: OperationSession) {
  if (!hasSlackDiscussionConfig()) {
    return { items: [], status: "disabled" as const };
  }

  try {
    const cached = await readTimedCache(operationReportCache.get(operation.operationId) ?? null, getResourceReadCacheTtlMs(), () =>
      readSlackOperationReportReferences(operation)
    );
    operationReportCache.set(operation.operationId, cached.entry);

    return {
      items: cached.value.items
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, MAX_DISCUSSION_ITEMS)
        .map(toOperationDiscussionItem),
      status: cached.value.status
    };
  } catch {
    return { items: [], status: "failed" as const };
  }
}

function readGenericDiscussionCache() {
  return readTimedCache(operationCollaborationCacheState.genericDiscussionCacheEntry, getResourceReadCacheTtlMs(), async () => {
    const reader = await getOperationSourceReader();
    return reader.readDiscussionReferences();
  }).then((cached) => {
    operationCollaborationCacheState.genericDiscussionCacheEntry = cached.entry;
    return cached.value;
  });
}

function mergeDiscussionSourceResults(results: Array<SourceReadResult<DiscussionReference>>): SourceReadResult<DiscussionReference> {
  const readAt = results
    .map((result) => result.readAt)
    .sort((a, b) => b.localeCompare(a))[0] ?? new Date(0).toISOString();

  return {
    source: "discussion",
    status: mergeDiscussionStatus(results),
    readAt,
    items: results.flatMap((result) => result.items),
    issues: results.flatMap((result) => result.issues)
  };
}

function mergeDiscussionStatus(results: Array<SourceReadResult<DiscussionReference>>): SourceReadStatus {
  if (results.length === 0) {
    return "disabled";
  }

  if (results.every((result) => result.status === "failed")) {
    return "failed";
  }

  if (results.some((result) => result.status === "failed")) {
    return "partial";
  }

  if (results.some((result) => result.status === "partial")) {
    return "partial";
  }

  if (results.some((result) => result.status === "ok")) {
    return "ok";
  }

  return "disabled";
}

function toOperationDiscussionItem(item: DiscussionReference): OperationDiscussionItem {
  const sourceKind = inferDiscussionSourceKind(item);

  return {
    id: item.sourceMessageId,
    occurredAt: item.occurredAt,
    sourceKind,
    sourceLabel: item.sourceLabel ?? discussionSourceLabel(sourceKind),
    sourceUrl: item.sourceUrl,
    summary: item.summary,
    title: item.title
  };
}

function inferDiscussionSourceKind(item: DiscussionReference): DiscussionReferenceSourceKind {
  if (item.sourceKind) {
    return item.sourceKind;
  }

  const sourceUrl = item.sourceUrl.toLowerCase();

  if (sourceUrl.includes("slack.com") || sourceUrl.startsWith("slack://")) {
    return "slack";
  }

  if (sourceUrl.includes("mail.google.com") || sourceUrl.startsWith("mailto:")) {
    return "email";
  }

  return "other";
}

function discussionSourceLabel(sourceKind: DiscussionReferenceSourceKind) {
  if (sourceKind === "slack") {
    return "Slack";
  }

  if (sourceKind === "email") {
    return "메일";
  }

  return "원천";
}

function matchesOperationDiscussion(item: DiscussionReference, operation: OperationSession) {
  const itemKey = normalizeMatchText(item.operationKey);
  const itemText = normalizeMatchText([
    item.operationKey,
    item.title,
    item.summary ?? ""
  ].join(" "));
  const exactKeys = [
    operation.operationId,
    operation.courseId
  ]
    .map(normalizeMatchText)
    .filter((value) => value.length >= 2);

  if (exactKeys.some((key) => itemKey === key || itemText.includes(key))) {
    return true;
  }

  const companyHit = hasAnyToken(itemText, tokenizeMatchText(operation.companyName));
  const courseScore = scoreTokenHits(itemText, tokenizeMatchText(operation.courseName));
  const peopleScore = [
    operation.om,
    operation.ld,
    operation.instructors,
    operation.coach
  ].reduce((score, value) => score + scoreTokenHits(itemText, tokenizePersonText(value)), 0);
  const roundMatch = getDiscussionRoundMatch(itemText, operation.roundNo);
  const roundHit = roundMatch.hit;
  const dateHit = isDiscussionNearOperation(item.occurredAt, operation);
  const sourceKind = inferDiscussionSourceKind(item);

  if (sourceKind === "email") {
    return matchesEmailOperationDiscussion({
      companyHit,
      courseScore,
      dateHit,
      peopleScore,
      roundConflict: roundMatch.conflict,
      roundHit
    });
  }

  if (!companyHit) {
    return courseScore >= 2 && peopleScore >= 2 && dateHit;
  }

  const score =
    10 +
    courseScore * 4 +
    peopleScore * 3 +
    (roundHit ? 2 : 0) +
    (dateHit ? 3 : 0);

  return score >= 17 && (courseScore > 0 || peopleScore >= 2 || roundHit);
}

function matchesEmailOperationDiscussion({
  companyHit,
  courseScore,
  dateHit,
  peopleScore,
  roundConflict,
  roundHit
}: {
  companyHit: boolean;
  courseScore: number;
  dateHit: boolean;
  peopleScore: number;
  roundConflict: boolean;
  roundHit: boolean;
}) {
  if (roundConflict) {
    return false;
  }

  if (!dateHit) {
    return false;
  }

  if (!companyHit) {
    return courseScore >= 2 && peopleScore >= 1;
  }

  if (peopleScore >= 1) {
    return true;
  }

  if (courseScore >= 2) {
    return true;
  }

  return roundHit && (peopleScore > 0 || courseScore > 0);
}

function normalizeMatchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function getDiscussionRoundMatch(text: string, operationRoundNo: string) {
  const operationRound = normalizeRoundNumber(operationRoundNo);
  const mentionedRounds = extractMentionedRoundNumbers(text);

  if (!operationRound) {
    return {
      conflict: false,
      hit: false
    };
  }

  if (mentionedRounds.size === 0) {
    return {
      conflict: false,
      hit: false
    };
  }

  return {
    conflict: !mentionedRounds.has(operationRound),
    hit: mentionedRounds.has(operationRound)
  };
}

function extractMentionedRoundNumbers(text: string) {
  const rounds = new Set<string>();
  const pattern = /(\d{1,2})(회차|차수|주차|차)/g;
  let match = pattern.exec(text);

  while (match) {
    const roundNumber = normalizeRoundNumber(match[1] ?? "");

    if (roundNumber) {
      rounds.add(roundNumber);
    }

    match = pattern.exec(text);
  }

  return rounds;
}

function normalizeRoundNumber(value: string) {
  const numberText = value.match(/\d{1,2}/)?.[0] ?? "";
  const parsed = Number(numberText);

  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : "";
}

function tokenizeMatchText(value: string) {
  return value
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/i)
    .map(normalizeMatchText)
    .filter((token) => token.length >= 2)
    .filter((token) => !isWeakMatchToken(token));
}

function tokenizePersonText(value: string) {
  return value
    .replace(/강사님|강사|코치님|코치|튜터님|튜터/g, " ")
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/i)
    .map(normalizeMatchText)
    .filter((token) => token.length >= 2)
    .filter((token) => !isWeakMatchToken(token));
}

function hasAnyToken(text: string, tokens: string[]) {
  return tokens.some((token) => text.includes(token));
}

function scoreTokenHits(text: string, tokens: string[]) {
  const uniqueTokens = new Set(tokens);
  let score = 0;

  for (const token of uniqueTokens) {
    if (text.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function isWeakMatchToken(token: string) {
  return new Set([
    "ai",
    "ax",
    "dx",
    "과정",
    "교육",
    "실습",
    "활용",
    "기초",
    "심화",
    "특강",
    "워크숍",
    "workshop"
  ]).has(token);
}

function isDiscussionNearOperation(occurredAt: string, operation: OperationSession) {
  const occurredDate = parseDate(occurredAt);
  const startDate = parseDate(operation.startDate);
  const endDate = parseDate(operation.endDate);

  if (!occurredDate || !startDate || !endDate) {
    return false;
  }

  const oldest = new Date(startDate);
  oldest.setUTCMonth(oldest.getUTCMonth() - 3);
  const latest = new Date(endDate);
  latest.setUTCMonth(latest.getUTCMonth() + 2);

  return occurredDate.getTime() >= oldest.getTime() && occurredDate.getTime() <= latest.getTime();
}

function parseDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}
