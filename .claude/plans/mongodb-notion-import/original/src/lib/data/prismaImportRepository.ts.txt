import type { ImportRunDetail } from "./importTypes";
import type { ImportRepository } from "./importRepository";
import { presentImportRun, toSourceRecordPreview } from "./importReviewPresenter";
import { getPrismaClient } from "./prisma";

export class PrismaImportRepository implements ImportRepository {
  async listImportRuns() {
    const prisma = getPrismaClient();
    const runs = await prisma.dataImportRun.findMany({
      include: {
        _count: {
          select: {
            sourceRecords: true
          }
        }
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }]
    });

    return runs.map((run) => presentImportRun(run, run._count.sourceRecords));
  }

  async getImportRunById(id: string): Promise<ImportRunDetail | null> {
    const prisma = getPrismaClient();
    const run = await prisma.dataImportRun.findUnique({
      where: { id },
      include: {
        sourceRecords: {
          orderBy: [{ sourceSheet: "asc" }, { sourceRowNumber: "asc" }],
          include: {
            operationSession: {
              include: {
                course: {
                  include: {
                    company: true
                  }
                }
              }
            }
          },
          take: 200
        },
        _count: {
          select: {
            sourceRecords: true
          }
        }
      }
    });

    if (!run) return null;

    return {
      ...presentImportRun(run, run._count.sourceRecords),
      records: run.sourceRecords.map(toSourceRecordPreview)
    };
  }
}
