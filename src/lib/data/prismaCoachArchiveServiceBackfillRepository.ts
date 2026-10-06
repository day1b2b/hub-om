import { Prisma, type PrismaClient } from "@prisma/client";
import type { CoachArchiveServiceBackfillRepository, CoachArchiveServiceBackfillSummary } from "./coachArchiveServiceBackfillRepository";
import { getPrismaClient } from "./prisma";
import { archiveNullableTimestamp, archiveObject, archiveRequiredTimestamp, archiveStringOrNull, coachArchivePatch, sameArchiveValue } from "./coachArchiveServiceBackfillValues";
import { indexField } from "../privacy/fields";

const PAGE_SIZE = 250;
const TRANSACTION_OPTIONS = { isolationLevel: "RepeatableRead", timeout: 120_000 } as const;
async function latestRows(tx: Prisma.TransactionClient, tableName: string, rowKeys?: string[]) {
  const latest = new Map<string, { id: string; rowKey: string; rowData: Prisma.JsonValue }>();
  let cursor: string | undefined;
  for (;;) {
    const rows = await tx.coachdbArchiveRow.findMany({
      where: { tableSchema: "public", tableName, ...(rowKeys ? { rowKey: { in: rowKeys } } : {}), snapshot: { status: "completed" } },
      select: { id: true, rowKey: true, rowData: true },
      orderBy: [{ snapshot: { startedAt: "desc" } }, { id: "desc" }],
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) if (!latest.has(row.rowKey)) latest.set(row.rowKey, row);
    cursor = rows.at(-1)!.id;
  }
  return latest;
}

type LatestArchiveMetadata = { id: string; row_key_pii_index: string | null };
async function latestArchivePage(tx: Prisma.TransactionClient, tableName: string, afterIndex?: string) {
  const metadata = await tx.$queryRaw<LatestArchiveMetadata[]>(Prisma.sql`
    SELECT DISTINCT ON (ar.row_key_pii_index)
      ar.id, ar.row_key_pii_index
    FROM coachdb_archive_rows ar
    JOIN coachdb_archive_snapshots s ON s.id = ar.snapshot_id
    WHERE s.status = 'completed'
      AND ar.table_schema = 'public'
      AND ar.table_name = ${tableName}
      ${afterIndex ? Prisma.sql`AND ar.row_key_pii_index > ${afterIndex}` : Prisma.empty}
    ORDER BY ar.row_key_pii_index ASC, s.started_at DESC, ar.id DESC
    LIMIT ${PAGE_SIZE}
  `);
  if (metadata.some(row => row.row_key_pii_index === null)) throw new Error("Archive index mismatch.");
  if (!metadata.length) return { rows: [] as Array<{ id: string; rowKey: string; rowData: Prisma.JsonValue }>, nextIndex: undefined };
  const payload = await tx.coachdbArchiveRow.findMany({
    where: { id: { in: metadata.map(row => row.id) } }, select: { id: true, rowKey: true, rowData: true },
  });
  const byId = new Map(payload.map(row => [row.id, row]));
  const rows = metadata.map(item => {
    const row = byId.get(item.id);
    if (!row || item.row_key_pii_index !== indexField("CoachdbArchiveRow", "rowKey", row.rowKey)) throw new Error("Archive index mismatch.");
    return row;
  });
  return { rows, nextIndex: metadata.at(-1)!.row_key_pii_index! };
}

async function assertArchiveIndexKey(tx: Prisma.TransactionClient): Promise<void> {
  const probe = await tx.$queryRaw<LatestArchiveMetadata[]>(Prisma.sql`
    SELECT ar.id, ar.row_key_pii_index
    FROM coachdb_archive_rows ar
    JOIN coachdb_archive_snapshots s ON s.id = ar.snapshot_id
    WHERE s.status = 'completed' AND ar.table_schema = 'public'
      AND ar.table_name IN ('coaches', 'schedule_access_logs')
    ORDER BY ar.id ASC LIMIT 1
  `);
  if (!probe.length) return;
  const row = await tx.coachdbArchiveRow.findUnique({ where: { id: probe[0].id }, select: { rowKey: true } });
  if (!row || probe[0].row_key_pii_index !== indexField("CoachdbArchiveRow", "rowKey", row.rowKey)) throw new Error("Archive index mismatch.");
}

export async function backfillCoachArchiveServiceData(
  db: Pick<PrismaClient, "$transaction">,
  { apply }: { apply: boolean },
): Promise<CoachArchiveServiceBackfillSummary> {
  return db.$transaction(async tx => {
    const summary: CoachArchiveServiceBackfillSummary = { coachRows: 0, changedCoaches: 0, accessLogRows: 0, updatedCoaches: 0, upsertedAccessLogs: 0 };
    await assertArchiveIndexKey(tx);
    let coachCursor: string | undefined;
    for (;;) {
      const coaches = await tx.coach.findMany({
        select: { id: true, sourceCoachId: true, accessToken: true, statusNote: true, returnDate: true, selfNote: true, portfolioUrl: true, availabilityDetail: true, managerNote: true, dxTag: true, deletedBy: true },
        orderBy: { id: "asc" }, take: PAGE_SIZE,
        ...(coachCursor ? { cursor: { id: coachCursor }, skip: 1 } : {}),
      });
      if (!coaches.length) break;
      const archivedCoaches = await latestRows(tx, "coaches", coaches.map(coach => coach.sourceCoachId));
      for (const coach of coaches) {
        const archive = archivedCoaches.get(coach.sourceCoachId);
        if (!archive) continue;
        summary.coachRows++;
        const row = archiveObject(archive.rowData);
        if (!row) throw new Error("Invalid archived coach row.");
        const data = coachArchivePatch(row);
        const changed = (Object.keys(data) as Array<keyof typeof data>).some(field => !sameArchiveValue(coach[field], data[field]));
        if (!changed) continue;
        summary.changedCoaches++;
        if (apply) {
          await tx.coach.update({ where: { id: coach.id }, data, select: { id: true } });
          summary.updatedCoaches++;
        }
      }
      coachCursor = coaches.at(-1)!.id;
    }

    let logCursor: string | undefined;
    for (;;) {
      const page = await latestArchivePage(tx, "schedule_access_logs", logCursor);
      if (!page.nextIndex) break;
      summary.accessLogRows += page.rows.length;
      const sourceIds = new Set<string>();
      for (const archive of page.rows) {
        const row = archiveObject(archive.rowData);
        if (!row) throw new Error("Invalid archived access log row.");
        const source = archiveStringOrNull(row.coach_id, "coach_id"); if (source !== null) sourceIds.add(source);
      }
      const coaches = await tx.coach.findMany({ where: { sourceCoachId: { in: [...sourceIds] } }, select: { id: true, sourceCoachId: true } });
      const coachBySource = new Map(coaches.map(coach => [coach.sourceCoachId, coach.id]));
      for (const archive of page.rows) {
        const row = archiveObject(archive.rowData)!; if (row.year_month == null) continue;
        const sourceCoachId = archiveStringOrNull(row.coach_id, "coach_id"); if (sourceCoachId === null) continue;
        const coachId = coachBySource.get(sourceCoachId); if (!coachId) continue;
        const yearMonth = archiveStringOrNull(row.year_month, "year_month"); if (yearMonth === null) continue;
        const data = { sourceAccessLogId: archive.rowKey, accessedAt: archiveRequiredTimestamp(row.accessed_at, "accessed_at"), lastEditedAt: archiveNullableTimestamp(row.last_edited_at, "last_edited_at") };
        if (apply) {
          await tx.coachScheduleAccessLog.upsert({ where: { coachId_yearMonth: { coachId, yearMonth } }, create: { coachId, yearMonth, ...data }, update: data, select: { id: true } });
          summary.upsertedAccessLogs++;
        }
      }
      logCursor = page.nextIndex;
    }
    return summary;
  }, TRANSACTION_OPTIONS);
}

export class PrismaCoachArchiveServiceBackfillRepository implements CoachArchiveServiceBackfillRepository {
  async backfill(options: { apply: boolean }) {
    const db = getPrismaClient();
    try { return await backfillCoachArchiveServiceData(db, options); }
    finally { await db.$disconnect(); }
  }
}
