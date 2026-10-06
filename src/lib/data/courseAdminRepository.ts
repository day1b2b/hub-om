export interface CourseAdminLookup {
  courseRecordId: string;
  processId: string;
  companyName: string;
  courseName: string;
  activeSessionCount: number;
}

/** Storage boundary only: callers retain the existing administrator authorization. */
export interface CourseAdminRepository {
  findCourse(processSeq: number): Promise<CourseAdminLookup | null>;
  /** null means no course; zero is a successful no-op, including repeated deletion. */
  softDeleteCourseSessions(courseId: string, deletedBy: string | null): Promise<number | null>;
}
