import type { OperationSession } from "@/lib/data/operationTypes";
import { getOperationSourceReader } from "@/lib/sourceReads";
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
  discussionIssues: SourceReadIssue[];
  discussionReferences: OperationDiscussionItem[];
  discussionStatus: SourceReadStatus;
  lectureReports: OperationDiscussionItem[];
  lectureReportStatus: SourceReadStatus;
}

const operationDiscussionCache = new Map<string, TimedCacheEntry<SourceReadResult<DiscussionReference>>>();
const operationReportCache = new Map<string, TimedCacheEntry<SourceReadResult<DiscussionReference>>>();
let genericDiscussionCacheEntry: TimedCacheEntry<SourceReadResult<DiscussionReference>> | null = null;

export async function readOperationCollaboration(operation: OperationSession): Promise<OperationCollaboration> {
  const [discussionResult, reportResult] = await Promise.all([
    readOperationDiscussions(operation),
    readOperationReports(operation)
  ]);

  return {
    changeHistory: [],
    changeHistoryStatus: "disabled",
    discussionIssues: discussionResult.issues,
    discussionReferences: discussionResult.items,
    discussionStatus: discussionResult.status,
    lectureReports: reportResult.items,
    lectureReportStatus: reportResult.status
  };
}

async function readOperationDiscussions(operation: OperationSession) {
  try {
    const cached = hasSlackDiscussionConfig()
      ? await readOperationSpecificDiscussionCache(operation)
      : await readGenericDiscussionCache();
    const result = cached.value;

    return {
      issues: result.issues,
      items: result.items
        .filter((item) => matchesOperationDiscussion(item, operation))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 8)
        .map(toOperationDiscussionItem),
      status: result.status
    };
  } catch (error) {
    return {
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

function readOperationSpecificDiscussionCache(operation: OperationSession) {
  const cacheKey = operation.operationId;

  return readTimedCache(operationDiscussionCache.get(cacheKey) ?? null, getResourceReadCacheTtlMs(), () =>
    readSlackOperationDiscussionReferences(operation)
  ).then((cached) => {
    operationDiscussionCache.set(cacheKey, cached.entry);
    return cached;
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
        .slice(0, 3)
        .map(toOperationDiscussionItem),
      status: cached.value.status
    };
  } catch {
    return { items: [], status: "failed" as const };
  }
}

function readGenericDiscussionCache() {
  return readTimedCache(genericDiscussionCacheEntry, getResourceReadCacheTtlMs(), async () => {
    const reader = await getOperationSourceReader();
    return reader.readDiscussionReferences();
  }).then((cached) => {
    genericDiscussionCacheEntry = cached.entry;
    return cached;
  });
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
  const roundHit = Boolean(operation.roundNo) && itemText.includes(normalizeMatchText(`${operation.roundNo}회차`));
  const dateHit = isDiscussionNearOperation(item.occurredAt, operation);

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

function normalizeMatchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
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
