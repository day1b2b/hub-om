import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import { DuplicateCompanyMergeError, type DuplicateCompanyMergeRepository, type DuplicateCompanyMergeResult } from "./duplicateCompanyMergeRepository";

async function execute(tx: Prisma.TransactionClient, sourceName: string, targetName: string, apply: boolean): Promise<DuplicateCompanyMergeResult> {
  const [sources, targets] = await Promise.all([
    tx.company.findMany({ where: { name: sourceName } }),
    tx.company.findMany({ where: { name: targetName } }),
  ]);
  if (sources.length !== 1) throw new DuplicateCompanyMergeError("SOURCE_NOT_UNIQUE");
  if (targets.length !== 1) throw new DuplicateCompanyMergeError("TARGET_NOT_UNIQUE");
  const source = sources[0], target = targets[0];
  if (source.id === target.id) throw new DuplicateCompanyMergeError("SAME_COMPANY");
  const sourceCourses = await tx.course.findMany({ where: { companyId: source.id }, orderBy: { id: "asc" }, include: { _count: { select: { sessions: true } } } });
  if (!sourceCourses.length) return { sourceId: source.id, targetId: target.id, courses: [], labels: [], remainingCourses: 0, reassignedCourses: 0, mergedCourses: 0, updatedSessions: 0, reassignedLabels: 0, discardedLabels: 0 };
  const targetCourses = await tx.course.findMany({ where: { companyId: target.id } });
  const targetCourse = new Map(targetCourses.map(row => [JSON.stringify([row.courseId, row.name]), row]));
  const courses = sourceCourses.map(row => { const existing = targetCourse.get(JSON.stringify([row.courseId, row.name])); return {
    action: existing ? "merge-into-existing" as const : "reassign" as const, courseId: row.courseId, name: row.name,
    sessionCount: row._count.sessions, targetCourseId: existing?.id ?? null,
  }; });
  const sourceLabels = await tx.courseIdLabel.findMany({ where: { companyId: source.id }, orderBy: { id: "asc" } });
  const targetLabels = await tx.courseIdLabel.findMany({ where: { companyId: target.id } });
  const targetLabel = new Map(targetLabels.map(row => [row.courseId, row]));
  const labels = sourceLabels.map(row => { const existing = targetLabel.get(row.courseId); return {
    action: existing ? "discard-source" as const : "reassign" as const, courseId: row.courseId, label: row.label, targetLabel: existing?.label ?? null,
  }; });
  let reassignedCourses = 0, mergedCourses = 0, updatedSessions = 0, reassignedLabels = 0, discardedLabels = 0;
  if (apply) {
    for (const [index, row] of sourceCourses.entries()) {
      const plan = courses[index];
      if (plan.action === "merge-into-existing") {
        const moved = await tx.operationSession.updateMany({ where: { courseRecordId: row.id }, data: { courseRecordId: plan.targetCourseId! } });
        updatedSessions += moved.count;
        await tx.course.delete({ where: { id: row.id } }); mergedCourses++;
      } else { await tx.course.update({ where: { id: row.id }, data: { companyId: target.id } }); reassignedCourses++; }
    }
    for (const [index, row] of sourceLabels.entries()) {
      if (labels[index].action === "discard-source") { await tx.courseIdLabel.delete({ where: { id: row.id } }); discardedLabels++; }
      else { await tx.courseIdLabel.update({ where: { id: row.id }, data: { companyId: target.id } }); reassignedLabels++; }
    }
  }
  const remainingCourses = apply ? await tx.course.count({ where: { companyId: source.id } }) : sourceCourses.length;
  return { sourceId: source.id, targetId: target.id, courses, labels, remainingCourses, reassignedCourses, mergedCourses, updatedSessions, reassignedLabels, discardedLabels };
}

export class PrismaDuplicateCompanyMergeRepository implements DuplicateCompanyMergeRepository {
  private readonly client: PrismaClient;
  constructor(client: PrismaClient = getPrismaClient()) { this.client = client; }
  async merge(input: { sourceName: string; targetName: string; apply: boolean }) {
    try {
      return await this.client.$transaction(tx => execute(tx, input.sourceName, input.targetName, input.apply), {
        isolationLevel: input.apply ? Prisma.TransactionIsolationLevel.Serializable : Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5_000, timeout: 30_000,
      });
    } catch (error) {
      if (error instanceof DuplicateCompanyMergeError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2025", "P2034"].includes(error.code)) {
        throw new DuplicateCompanyMergeError("CONCURRENT_CHANGE");
      }
      throw new DuplicateCompanyMergeError("TRANSACTION_FAILED");
    }
  }
}
