/** 한 세션의 현재 상태와 되돌릴 값. */
export interface CourseNameRestoreRow {
  companyName: string;
  /** 원천 기록이 없어 되돌릴 수 없는 이유(있으면 restorable=false). */
  blockedReason: null | string;
  currentCourseName: string;
  endDate: string;
  operationId: string;
  restorable: boolean;
  roundNo: string;
  /** 원천 적재 당시의 과정명. 없으면 null. */
  sourceCourseName: null | string;
  startDate: string;
  updatedAt: string;
  updatedBy: null | string;
}

/** 이 코스ID가 가진 과정 행. 세션 0개인 행은 합쳐지기 전 이름이 남은 흔적이다. */
export interface CourseNameRestoreCourse {
  companyName: string;
  courseName: string;
  id: string;
  sessionCount: number;
  updatedAt: string;
}

export interface CourseNameRestorePlan {
  snapshot: string;
  companyNames: string[];
  courseId: string;
  courses: CourseNameRestoreCourse[];
  rows: CourseNameRestoreRow[];
}

export interface CourseNameRestoreResult {
  moved: Array<{ from: string; operationId: string; to: string }>;
  skipped: Array<{ operationId: string; reason: string }>;
}

export class CourseNameRestoreConflict extends Error {
  constructor(message = "조회 이후 데이터가 바뀌었습니다. 다시 조회하고 선택해 주세요.") { super(message); }
}

/** Opaque snapshots are checked by the same backend that produced the plan. */
export interface CourseNameRestoreRepository {
  planCourseNameRestore(rawCourseId: string): Promise<CourseNameRestorePlan>;
  applyCourseNameRestore(rawCourseId: string, operationIds: string[], snapshot: string, actorEmail: string | null): Promise<CourseNameRestoreResult>;
}
