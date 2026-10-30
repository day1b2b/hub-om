import type { OperationRepository } from "./operationRepository";
import { getOperationRepository } from "./operationRepositoryFactory";
import { disconnectPrismaClient } from "./prisma";
import { planCourseLevelReportLinksBackfill, type CourseLevelReportLinksPlan } from "./courseLevelReportLinksBackfill";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

const ACTOR = "system:course-level-report-links-backfill";

export interface CourseLevelReportLinksConflictSummary {
  courseRecordId: string;
  companyName: string;
  courseName: string;
  field: string;
}

export interface CourseLevelReportLinksBackfillSummary {
  apply: boolean;
  courseCount: number;
  summaryByField: CourseLevelReportLinksPlan["summaryByField"];
  conflicts: CourseLevelReportLinksConflictSummary[];
  updatedCourseCount: number;
}

interface Dependencies {
  repository(): OperationRepository;
  close(): Promise<void>;
}

const defaults: Dependencies = { repository: getOperationRepository, close: disconnectPrismaClient };

export async function runCourseLevelReportLinksBackfillCommand(
  args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults,
): Promise<CourseLevelReportLinksBackfillSummary> {
  const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) {
    throw new Error("COURSE_LEVEL_REPORT_LINKS_BACKFILL_CONFIRMATION_REQUIRED");
  }
  let result: CourseLevelReportLinksBackfillSummary | undefined;
  let failed = false;
  const scoped = getDataRepositoryOverride("operations");
  try {
    if (!scoped) loadEnvironment();
    const repository = scoped ?? dependencies.repository();
    const plan = planCourseLevelReportLinksBackfill(await repository.listOperations());

    const conflicts: CourseLevelReportLinksConflictSummary[] = [];
    for (const course of plan.courses) {
      for (const field of Object.keys(course.fields) as (keyof typeof course.fields)[]) {
        if (course.fields[field].kind === "conflict") {
          conflicts.push({ courseRecordId: course.courseRecordId, companyName: course.companyName, courseName: course.courseName, field });
        }
      }
    }

    let updatedCourseCount = 0;
    if (apply) {
      for (const course of plan.courses) {
        let updated = false;

        if (course.fields.resultReportLink.kind === "candidate") {
          await repository.upsertCourseReportLink(course.courseRecordId, course.fields.resultReportLink.value, ACTOR);
          updated = true;
        }

        const link = course.fields.lectureManagementLink;
        const note = course.fields.lectureManagementNote;
        if (link.kind === "candidate" || note.kind === "candidate") {
          await repository.upsertCourseLectureManagement(course.courseRecordId, {
            lectureManagementLink: link.kind === "candidate" || link.kind === "preserved" ? link.value : "",
            lectureManagementNote: note.kind === "candidate" || note.kind === "preserved" ? note.value : ""
          }, ACTOR);
          updated = true;
        }

        if (updated) updatedCourseCount++;
      }
    }

    result = { apply, courseCount: plan.courseCount, summaryByField: plan.summaryByField, conflicts, updatedCourseCount };
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("COURSE_LEVEL_REPORT_LINKS_BACKFILL_FAILED");
  return result;
}
