import { Prisma } from "@prisma/client";
import type { CoachDbArchiveInput, CoachDbArchiveRepository } from "./coachDbArchiveRepository";
import { summarizeCoachDbArchive } from "./coachDbArchiveRepository";
import { getPrismaClient } from "./prisma";
export class PrismaCoachDbArchiveRepository implements CoachDbArchiveRepository {
  async archive(input: CoachDbArchiveInput, apply: boolean) {
    const summary = summarizeCoachDbArchive(input); if (!apply) return summary;
    await getPrismaClient().$transaction(async tx => {
      const snapshot = await tx.coachdbArchiveSnapshot.create({ data: { sourceDatabase: input.sourceDatabase, sourceSchema: input.sourceSchema } });
      for (const table of input.tables) for (let offset = 0; offset < table.rows.length; offset += 250) {
        await tx.coachdbArchiveRow.createMany({ data: table.rows.slice(offset, offset + 250).map(row => ({ snapshotId: snapshot.id,
          tableSchema: table.schema, tableName: table.name, rowKey: row.rowKey, rowData: row.rowData as Prisma.InputJsonValue })) });
      }
      await tx.coachdbArchiveSnapshot.update({ where: { id: snapshot.id }, data: { tableCount: summary.tableCount, rowCount: summary.rowCount, status: "completed", finishedAt: new Date() } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 300_000 });
    return summary;
  }
}
