export type DuplicateCompanyCoursePlan = {
  action: "reassign" | "merge-into-existing";
  courseId: string;
  name: string;
  sessionCount: number;
  targetCourseId: string | null;
};
export type DuplicateCompanyLabelPlan = {
  action: "reassign" | "discard-source";
  courseId: string;
  label: string;
  targetLabel: string | null;
};
export type DuplicateCompanyMergeResult = {
  sourceId: string;
  targetId: string;
  courses: DuplicateCompanyCoursePlan[];
  labels: DuplicateCompanyLabelPlan[];
  remainingCourses: number;
  reassignedCourses: number;
  mergedCourses: number;
  updatedSessions: number;
  reassignedLabels: number;
  discardedLabels: number;
};
export interface DuplicateCompanyMergeRepository {
  merge(input: { sourceName: string; targetName: string; apply: boolean }): Promise<DuplicateCompanyMergeResult>;
}
export class DuplicateCompanyMergeError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Duplicate company merge failed: ${code}`); this.code = code; }
}
