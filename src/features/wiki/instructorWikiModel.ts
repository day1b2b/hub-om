import type { CoachStatusValue, CoachSummary } from "@/lib/data/coachTypes";
import type { OperationSession, OperationStatus } from "@/lib/data/operationTypes";

// =============================================================================
// 강사위키 뷰 모델
// - 주 데이터: 운영 현황(operations). 강사(instructors)별로 담당 기업/과정을 묶는다.
// - 부가(enrich): coach-db(= 강사 DB) 연결 시 강사명 매칭으로 전문분야/평가/커리큘럼 보강.
// - 연락처/계좌/소속(affiliation) 등 PII는 다루지 않는다(별도 PII 권한 계층 전용).
// =============================================================================

export type InstructorWikiProvenance = "operations" | "empty";

// 운영 현황에서 이 사람이 맡은 역할. instructors=강사, coach=실습코치.
export type InstructorRole = "강사" | "실습코치";

export interface InstructorCourse {
  operationId: string;
  companyName: string;
  courseName: string;
  roundNo: string;
  role: InstructorRole;
  status: OperationStatus;
  startDate: string;
  endDate: string;
  om: string;
  educationFormat: string;
  region: string;
  instructorSatisfaction: string;
  instructorWikiLink: string;
}

export interface InstructorCoachInfo {
  coachId: string;
  status: CoachStatusValue;
  workType: string | null;
  fields: string[];
  avgRating: number | null;
  curriculums: string[];
}

export interface InstructorWikiEntry {
  id: string;
  name: string;
  companies: string[];
  courseCount: number;
  courses: InstructorCourse[];
  coach: InstructorCoachInfo | null;
}

export const STATUS_LABEL: Record<CoachStatusValue, string> = {
  active: "활동중",
  pending: "대기",
  inactive: "비활동"
};

export const STATUS_CLASS: Record<CoachStatusValue, string> = {
  active: "active",
  pending: "planned-assignment",
  inactive: "needs-assignment"
};

export const OPERATION_STATUS_CLASS: Record<OperationStatus, string> = {
  배정필요: "needs-assignment",
  배정예정: "planned-assignment",
  진행중: "active",
  완료: "done",
  회고완료: "done",
  아카이빙필요: "needs-assignment"
};

export const ROLE_CLASS: Record<InstructorRole, string> = {
  강사: "done",
  실습코치: "muted"
};

// 운영 현황 진행상태 중 "진행/예정" 성격
const ACTIVE_OPERATION_STATUSES: OperationStatus[] = ["배정필요", "배정예정", "진행중"];

// ---- 파싱 / 집계 -----------------------------------------------------------

// 운영 현황 instructors 필드는 자유 텍스트다. 구분자로만 분리하고 이름은 원문 유지한다.
// (예: "박강사", "홍길동, 김철수", "홍길동/이영희")
export function parseInstructorNames(raw: string): string[] {
  return (raw ?? "")
    .split(/[,/·;\n、，]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function aggregateInstructors(operations: OperationSession[]): InstructorWikiEntry[] {
  const byName = new Map<string, InstructorWikiEntry>();

  const addCourse = (operation: OperationSession, name: string, role: InstructorRole) => {
    let entry = byName.get(name);
    if (!entry) {
      entry = { id: name, name, companies: [], courseCount: 0, courses: [], coach: null };
      byName.set(name, entry);
    }
    entry.courses.push({
      operationId: operation.operationId,
      companyName: operation.companyName,
      courseName: operation.courseName,
      roundNo: operation.roundNo,
      role,
      status: operation.operationStatus,
      startDate: operation.startDate,
      endDate: operation.endDate,
      om: operation.om,
      educationFormat: operation.educationFormat,
      region: operation.region,
      instructorSatisfaction: operation.instructorSatisfaction ?? "",
      instructorWikiLink: operation.instructorWikiLink ?? ""
    });
  };

  // 운영 현황의 강사(instructors) + 실습코치(coach) 모두 반영한다.
  for (const operation of operations) {
    for (const name of parseInstructorNames(operation.instructors)) {
      addCourse(operation, name, "강사");
    }
    for (const name of parseInstructorNames(operation.coach)) {
      addCourse(operation, name, "실습코치");
    }
  }

  const entries = Array.from(byName.values());
  for (const entry of entries) {
    entry.courses.sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
    entry.companies = Array.from(new Set(entry.courses.map((course) => course.companyName).filter(Boolean)));
    entry.courseCount = entry.courses.length;
  }

  return entries.sort((a, b) => b.courseCount - a.courseCount || a.name.localeCompare(b.name, "ko"));
}

export function hasActiveCourse(entry: InstructorWikiEntry): boolean {
  return entry.courses.some((course) => ACTIVE_OPERATION_STATUSES.includes(course.status));
}

// 이 강사가 운영 현황에서 맡은 역할 목록(강사 · 실습코치)
export function roleSummary(entry: InstructorWikiEntry): InstructorRole[] {
  const roles = new Set(entry.courses.map((course) => course.role));
  return (["강사", "실습코치"] as InstructorRole[]).filter((role) => roles.has(role));
}

// coach-db 요약을 강사명 매칭으로 붙인다(정확 일치). 연결 실패/미매칭이면 coach는 null 유지.
export function attachCoachSummaries(entries: InstructorWikiEntry[], coaches: CoachSummary[]): void {
  const byName = new Map(coaches.map((coach) => [coach.name.trim(), coach]));
  for (const entry of entries) {
    const coach = byName.get(entry.name.trim());
    if (coach) {
      entry.coach = {
        coachId: coach.id,
        status: coach.status,
        workType: coach.workType,
        fields: coach.fields,
        avgRating: coach.avgRating,
        curriculums: []
      };
    }
  }
}

// ---- 표시 헬퍼 --------------------------------------------------------------

export function cleanCourseName(value: string): string {
  return (
    value
      .replace(/\[부가세\s*별도\]\s*/g, "")
      .replace(/\(B2B\)\s*/g, "")
      .trim() || value
  );
}

export function formatDateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[1]}.${Number(match[2])}.${Number(match[3])}`;
}

export function summarizeCompanies(companies: string[], max = 2): string {
  if (companies.length === 0) return "-";
  if (companies.length <= max) return companies.join(", ");
  return `${companies.slice(0, max).join(", ")} 외 ${companies.length - max}곳`;
}
