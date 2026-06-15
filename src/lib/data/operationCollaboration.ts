import type { OperationSession } from "@/lib/data/operationTypes";
import { getOperationSourceReader } from "@/lib/sourceReads";
import {
  hasSlackDiscussionConfig,
  readSlackOperationDiscussionReferences,
  readSlackOperationReportReferences
} from "@/lib/sourceReads/slackDiscussionReader";
import { getResourceReadCacheTtlMs, readTimedCache, type TimedCacheEntry } from "@/lib/timedCache";
import type { DiscussionReference, SourceReadIssue, SourceReadResult, SourceReadStatus } from "@/lib/sourceReads";

export interface OperationDiscussionItem {
  id: string;
  occurredAt: string;
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
        .map((item) => ({
          id: item.sourceMessageId,
          occurredAt: item.occurredAt,
          sourceUrl: item.sourceUrl,
          summary: item.summary,
          title: item.title
        })),
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
        .map((item) => ({
          id: item.sourceMessageId,
          occurredAt: item.occurredAt,
          sourceUrl: item.sourceUrl,
          summary: item.summary,
          title: item.title
        })),
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

function matchesOperationDiscussion(item: DiscussionReference, operation: OperationSession) {
  const operationKeys = [
    operation.operationId,
    operation.courseId,
    operation.companyName,
    operation.courseName
  ]
    .map(normalizeMatchText)
    .filter((value) => value.length >= 2);
  const itemKey = normalizeMatchText(item.operationKey);
  const itemText = normalizeMatchText(`${item.operationKey} ${item.title}`);

  return operationKeys.some((key) => itemKey === key || itemText.includes(key));
}

function normalizeMatchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}
