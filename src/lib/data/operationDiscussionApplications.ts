import { createHash } from "node:crypto";
import {
  ImportStatus as PrismaImportStatus,
  SourceTeam as PrismaSourceTeam
} from "@prisma/client";
import type { OperationDiscussionItem } from "@/lib/data/operationCollaboration";
import type { OperationSession, SourceTeam } from "@/lib/data/operationTypes";
import { getPrismaClient } from "@/lib/data/prisma";

const MAX_APPLY_ITEMS = 50;
const MAX_TITLE_LENGTH = 220;
const MAX_SUMMARY_LENGTH = 900;
const MAX_URL_LENGTH = 1200;

const PRISMA_SOURCE_TEAM: Record<SourceTeam, PrismaSourceTeam> = {
  "1팀": PrismaSourceTeam.TEAM_1,
  "2팀": PrismaSourceTeam.TEAM_2,
  "미분류": PrismaSourceTeam.UNKNOWN
};

export interface OperationDiscussionStoreResult {
  storedCount: number;
  runId: string | null;
  skippedCount: number;
}

export async function storeOperationDiscussionReferences({
  items,
  operation,
  storedBy
}: {
  items: OperationDiscussionItem[];
  operation: OperationSession;
  storedBy: string;
}): Promise<OperationDiscussionStoreResult> {
  const prisma = getPrismaClient();
  const normalizedItems = items
    .slice(0, MAX_APPLY_ITEMS)
    .map(normalizeDiscussionApplyItem)
    .filter((item): item is NormalizedDiscussionApplyItem => item !== null);
  const uniqueItems = dedupeDiscussionItems(normalizedItems);
  const fingerprints = uniqueItems.map((item) => item.sourceFingerprint);

  if (uniqueItems.length === 0) {
    return { runId: null, skippedCount: items.length, storedCount: 0 };
  }

  const existingRecords = await prisma.operationSourceRecord.findMany({
    select: { sourceFingerprint: true },
    where: {
      operationSessionId: operation.id,
      sourceFingerprint: { in: fingerprints }
    }
  });
  const existingFingerprints = new Set(
    existingRecords
      .map((record) => record.sourceFingerprint)
      .filter((value): value is string => Boolean(value))
  );
  const newItems = uniqueItems.filter((item) => !existingFingerprints.has(item.sourceFingerprint));

  if (newItems.length === 0) {
    return { runId: null, skippedCount: uniqueItems.length, storedCount: 0 };
  }

  const sourceTeam = PRISMA_SOURCE_TEAM[operation.sourceTeam ?? "미분류"];
  const finishedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.dataImportRun.create({
      data: {
        errorCount: 0,
        finishedAt,
        importedBy: storedBy,
        notes: "운영 상세에서 읽어온 Slack/메일 논의 참조를 누적 저장한 이력입니다.",
        rowCount: newItems.length,
        sourceName: "operation_discussion_capture",
        sourceTeam,
        sourceType: "discussion_capture",
        status: PrismaImportStatus.COMPLETED,
        successCount: newItems.length,
        validationLogs: {
          operationId: operation.operationId,
          sourceKinds: [...new Set(newItems.map((item) => item.sourceKind))]
        },
        workbookName: "hub_om_source_reads"
      }
    });

    await tx.operationSourceRecord.createMany({
      data: newItems.map((item, index) => ({
        importRunId: run.id,
        mappedFields: {
          courseId: operation.courseId,
          operationId: operation.operationId,
          sourceKind: item.sourceKind,
          sourceLabel: item.sourceLabel
        },
        operationSessionId: operation.id,
        rowSnapshot: {
          occurredAt: item.occurredAt,
          sourceKind: item.sourceKind,
          sourceLabel: item.sourceLabel,
          sourceMessageId: item.id,
          sourceUrl: item.sourceUrl,
          summary: item.summary,
          title: item.title
        },
        sourceFingerprint: item.sourceFingerprint,
        sourceRowNumber: index + 1,
        sourceSheet: `discussion_${item.sourceKind}`,
        sourceTeam,
        sourceWorkbook: "hub_om_source_reads"
      }))
    });

    return run;
  });

  return {
    runId: result.id,
    skippedCount: uniqueItems.length - newItems.length,
    storedCount: newItems.length
  };
}

interface NormalizedDiscussionApplyItem extends OperationDiscussionItem {
  sourceFingerprint: string;
}

function normalizeDiscussionApplyItem(item: OperationDiscussionItem): NormalizedDiscussionApplyItem | null {
  const id = normalizeText(item.id, 180);
  const sourceKind = item.sourceKind;
  const sourceUrl = normalizeUrl(item.sourceUrl);
  const title = normalizeText(item.title, MAX_TITLE_LENGTH);
  const occurredAt = normalizeDateTime(item.occurredAt);

  if (!id || !sourceUrl || !title || !occurredAt) {
    return null;
  }

  if (sourceKind !== "slack" && sourceKind !== "email" && sourceKind !== "other") {
    return null;
  }

  return {
    id,
    occurredAt,
    sourceFingerprint: discussionSourceFingerprint(sourceKind, id),
    sourceKind,
    sourceLabel: normalizeText(item.sourceLabel, 40) || defaultSourceLabel(sourceKind),
    sourceUrl,
    summary: normalizeText(item.summary ?? "", MAX_SUMMARY_LENGTH),
    title
  };
}

function discussionSourceFingerprint(sourceKind: OperationDiscussionItem["sourceKind"], id: string) {
  return `discussion:${sourceKind}:${createHash("sha256").update(id).digest("hex")}`;
}

function dedupeDiscussionItems(items: NormalizedDiscussionApplyItem[]) {
  const seen = new Set<string>();
  const deduped: NormalizedDiscussionApplyItem[] = [];

  for (const item of items) {
    if (seen.has(item.sourceFingerprint)) continue;

    seen.add(item.sourceFingerprint);
    deduped.push(item);
  }

  return deduped;
}

function normalizeText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeUrl(value: string) {
  const normalized = normalizeText(value, MAX_URL_LENGTH);

  if (!normalized) return "";
  if (normalized.startsWith("https://") || normalized.startsWith("http://") || normalized.startsWith("slack://")) {
    return normalized;
  }

  return "";
}

function normalizeDateTime(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function defaultSourceLabel(sourceKind: OperationDiscussionItem["sourceKind"]) {
  if (sourceKind === "slack") return "Slack";
  if (sourceKind === "email") return "메일";

  return "원천";
}
