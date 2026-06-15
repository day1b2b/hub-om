import { readFile } from "node:fs/promises";
import type { DiscussionReference, SourceReadResult } from "./sourceReadTypes";

const DEFAULT_ARCHIVE_SOURCE_LABEL = "메일";

interface ManualEmailArchiveRecord {
  courseId?: string;
  from?: string;
  messageId?: string;
  occurredAt?: string;
  operationId?: string;
  operationKey?: string;
  snippet?: string;
  sourceUrl?: string;
  summary?: string;
  subject?: string;
  title?: string;
}

interface ManualEmailArchiveFile {
  items?: ManualEmailArchiveRecord[];
  records?: ManualEmailArchiveRecord[];
}

export function hasManualEmailDiscussionArchiveConfig(): boolean {
  return Boolean(readManualEmailArchivePath());
}

export async function readManualEmailOperationDiscussionReferences(): Promise<SourceReadResult<DiscussionReference>> {
  const readAt = new Date().toISOString();
  const archivePath = readManualEmailArchivePath();

  if (!archivePath) {
    return {
      source: "discussion",
      status: "disabled",
      readAt,
      items: [],
      issues: []
    };
  }

  try {
    const records = await readManualEmailArchiveRecords(archivePath);
    const items = records
      .map((record, index) => mapManualArchiveRecord(record, index))
      .filter((item): item is DiscussionReference => Boolean(item));

    return {
      source: "discussion",
      status: "ok",
      readAt,
      items,
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
          code: "manual_email_archive_read_failed",
          message: "Manual email discussion archive could not be read.",
          recoverable: true
        }
      ]
    };
  }
}

function readManualEmailArchivePath() {
  return process.env.GMAIL_DISCUSSION_MANUAL_ARCHIVE_FILE?.trim() ?? "";
}

async function readManualEmailArchiveRecords(archivePath: string): Promise<ManualEmailArchiveRecord[]> {
  const content = await readFile(archivePath, "utf8");
  const parsed = JSON.parse(content) as ManualEmailArchiveFile | ManualEmailArchiveRecord[];

  if (Array.isArray(parsed)) {
    return parsed.filter(isManualArchiveRecord);
  }

  return [
    ...(parsed.records ?? []),
    ...(parsed.items ?? [])
  ].filter(isManualArchiveRecord);
}

function mapManualArchiveRecord(
  record: ManualEmailArchiveRecord,
  index: number
): DiscussionReference | null {
  const title = cleanupText(record.title ?? record.subject ?? "");
  const summary = buildManualArchiveSummary(record);
  const occurredAt = parseArchiveDate(record.occurredAt);

  if (!title || !occurredAt) {
    return null;
  }

  return {
    sourceKind: "email",
    sourceLabel: DEFAULT_ARCHIVE_SOURCE_LABEL,
    sourceMessageId: normalizeManualArchiveMessageId(record, index),
    operationKey: [
      record.operationKey,
      record.operationId ? `operationId:${record.operationId}` : "",
      record.courseId ? `courseId:${record.courseId}` : ""
    ].filter(Boolean).join(" "),
    title,
    occurredAt,
    sourceUrl: cleanupText(record.sourceUrl ?? "") || buildManualArchiveSourceUrl(title),
    summary
  };
}

function buildManualArchiveSourceUrl(title: string) {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`subject:${title}`)}`;
}

function buildManualArchiveSummary(record: ManualEmailArchiveRecord) {
  const summary = cleanupText(record.summary ?? "");

  if (summary) {
    return truncateText(summary, 160);
  }

  return truncateText(
    [
      cleanupText(record.subject ?? record.title ?? ""),
      cleanupText(record.from ?? "") ? `발신 ${cleanupText(record.from ?? "")}` : "",
      cleanupText(record.snippet ?? "")
    ].filter(Boolean).join(" · "),
    160
  );
}

function normalizeManualArchiveMessageId(record: ManualEmailArchiveRecord, index: number) {
  const messageId = cleanupText(record.messageId ?? "");

  if (messageId.startsWith("manual-email:")) {
    return messageId;
  }

  return `manual-email:${messageId || index + 1}`;
}

function parseArchiveDate(value: string | undefined) {
  if (!value) {
    return "";
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function cleanupText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number) {
  const normalized = cleanupText(value);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function isManualArchiveRecord(value: unknown): value is ManualEmailArchiveRecord {
  return Boolean(value) && typeof value === "object";
}
