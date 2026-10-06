import type { Prisma, PrismaClient } from "@prisma/client";

const PAGE_SIZE = 250;
export const BACKFILL_TRANSACTION_OPTIONS = { isolationLevel: "RepeatableRead", timeout: 120_000 } as const;
export type CoachTokenBackfillSummary = {
  archivedTokens: number;
  missingTokens: number;
  changedTokens: number;
  updatedTokens: number;
};

export function parseCoachTokenBackfillArgs(args: string[]): { apply: boolean } {
  const allowed = new Set(["--dry-run", "--apply", "--backup-confirmed", "--maintenance-confirmed"]);
  if (args.some(arg => !allowed.has(arg)) || (args.includes("--dry-run") && args.includes("--apply"))) {
    throw new Error("Invalid backfill arguments.");
  }
  const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) {
    throw new Error("Apply requires backup and maintenance confirmation.");
  }
  return { apply };
}

/** The client must be getPrismaClient(), including its encryption adapter.
 * One repeatable-read transaction preserves all-or-nothing writes and a stable archive.
 * Only a coach page and an archive page are retained; no plaintext token map grows
 * with the database. Timeout/conflict fails the entire run rather than committing a prefix.
 */
export async function backfillCoachAccessTokens(
  db: Pick<PrismaClient, "$transaction">,
  { apply }: { apply: boolean },
): Promise<CoachTokenBackfillSummary> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const summary: CoachTokenBackfillSummary = { archivedTokens: 0, missingTokens: 0, changedTokens: 0, updatedTokens: 0 };
    let coachCursor: string | undefined;
    for (;;) {
      const coaches = await tx.coach.findMany({
        select: { id: true, sourceCoachId: true, accessToken: true },
        orderBy: { id: "asc" }, take: PAGE_SIZE,
        ...(coachCursor ? { cursor: { id: coachCursor }, skip: 1 } : {}),
      });
      if (!coaches.length) break;
      const latest = new Map<string, string>();
      let archiveCursor: string | undefined;
      for (;;) {
        const rows = await tx.coachdbArchiveRow.findMany({
          where: {
            tableSchema: "public", tableName: "coaches",
            rowKey: { in: coaches.map(coach => coach.sourceCoachId) },
            snapshot: { status: "completed" },
          },
          select: { id: true, rowKey: true, rowData: true },
          // Old SQL did not break startedAt ties. ID provides deterministic tie handling.
          orderBy: [{ snapshot: { startedAt: "desc" } }, { id: "desc" }],
          take: PAGE_SIZE,
          ...(archiveCursor ? { cursor: { id: archiveCursor }, skip: 1 } : {}),
        });
        if (!rows.length) break;
        for (const row of rows) {
          if (latest.has(row.rowKey)) continue;
          const data = row.rowData;
          if (!data || typeof data !== "object" || Array.isArray(data)) continue;
          const token = data.access_token;
          if (token == null) continue;
          // Empty strings are valid non-null values under the legacy selection rule.
          // Reject malformed source values without including the value in the error.
          if (typeof token !== "string") throw new Error("Archive token must be a string.");
          latest.set(row.rowKey, token);
        }
        if (latest.size === coaches.length || rows.length < PAGE_SIZE) break;
        archiveCursor = rows[rows.length - 1].id;
      }
      for (const coach of coaches) {
        const token = latest.get(coach.sourceCoachId);
        if (token === undefined) continue;
        summary.archivedTokens++;
        if (coach.accessToken === null) summary.missingTokens++;
        if (coach.accessToken === token) continue;
        summary.changedTokens++;
        if (apply) {
          await tx.coach.update({ where: { id: coach.id }, data: { accessToken: token }, select: { id: true } });
          summary.updatedTokens++;
        }
      }
      if (coaches.length < PAGE_SIZE) break;
      coachCursor = coaches[coaches.length - 1].id;
    }
    return summary;
  }, BACKFILL_TRANSACTION_OPTIONS);
}
