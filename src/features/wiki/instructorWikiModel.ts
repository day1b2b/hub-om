import type { CoachStatusValue, CoachSummary } from "@/lib/data/coachTypes";
import type { OperationSession, OperationStatus } from "@/lib/data/operationTypes";

// =============================================================================
// 강사위키 뷰 모델
// - 주 데이터: 운영 현황(operations). 강사(instructors)별로 담당 기업/과정을 묶는다.
// - 부가(enrich): coach-db(= 강사 DB) 연결 시 강사명 매칭으로 전문분야/평가/커리큘럼 보강.
// - 연락처/계좌/소속(affiliation) 등 PII는 다루지 않는다(별도 PII 권한 계층 전용).
// =============================================================================

export type InstructorWikiProvenance = "operations" | "notion" | "empty";

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
  /** 노션 강사 DB의 "카테고리"(전문분야). 그룹핑·필터용. 노션 미연결이면 빈 배열. */
  categories: string[];
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

// 시트 instructors 칸에 강사명 대신 들어오는 표기. 강사가 아니므로 위키 목록에서 제외한다.
// 사람 이름이 아니라 자리표시자로 들어온 값들이다. 걸러내지 않으면 강사위키에 "강사"라는
// 이름의 강사가 생긴다(배포 화면에서 실제로 확인됨).
const NON_INSTRUCTOR_TOKENS = new Set([
  "없음",
  "해당없음",
  "미정",
  "추후",
  "추후미정",
  "tbd",
  "-",
  "x",
  "vod",
  "(vod)",
  // 역할명이 이름 자리에 들어온 경우.
  "강사",
  "코치",
  "실습코치",
  "담당",
  "담당자"
]);

// 운영 현황 instructors 필드는 자유 텍스트다. 구분자로만 분리하고 이름은 원문 유지한다.
// (예: "박강사", "홍길동, 김철수", "홍길동/이영희")
export function parseInstructorNames(raw: string): string[] {
  // 구분자: 쉼표/슬래시/가운뎃점/세미콜론 + 공백(시트는 강사명을 공백으로 나열).
  return (raw ?? "")
    .split(/[\s,/·;、，]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => !NON_INSTRUCTOR_TOKENS.has(name.toLowerCase()));
}

export function aggregateInstructors(operations: OperationSession[]): InstructorWikiEntry[] {
  const byName = new Map<string, InstructorWikiEntry>();

  const addCourse = (operation: OperationSession, name: string, role: InstructorRole) => {
    let entry = byName.get(name);
    if (!entry) {
      entry = { id: name, name, companies: [], courseCount: 0, courses: [], coach: null, categories: [] };
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

  // 강사위키는 운영 현황의 강사(instructors)만 집계한다. 실습코치(coach)는 제외.
  for (const operation of operations) {
    for (const name of parseInstructorNames(operation.instructors)) {
      addCourse(operation, name, "강사");
    }
  }

  const entries = Array.from(byName.values());
  for (const entry of entries) {
    entry.courses.sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
    entry.companies = Array.from(new Set(entry.courses.map((course) => course.companyName).filter(Boolean)));
    entry.courseCount = entry.courses.length;
  }

  // 목록 기본 정렬은 강사명 ㄱㄴㄷ순(기업위키와 동일). 운영 건수는 행마다 따로 표시된다.
  return entries.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export function hasActiveCourse(entry: InstructorWikiEntry): boolean {
  return entry.courses.some((course) => ACTIVE_OPERATION_STATUSES.includes(course.status));
}

// 운영 현황에 배정 이력이 있는지. 노션에만 있는 강사는 false.
export function hasOperationHistory(entry: InstructorWikiEntry): boolean {
  return entry.courses.length > 0;
}

/**
 * 강사 명단의 기준을 노션 강사 DB로 넓힌다.
 *
 * 강사 정보(소속·카테고리·강사료)는 노션에서 오고, 담당 코스·과정은 운영 현황에서 온다.
 * 그래서 운영 현황 기반 entry는 그대로 두고(코스 이력 보존), 노션에만 있는 이름은
 * 코스가 빈 entry로 추가한다. 이름이 겹치면 운영 현황 쪽 entry를 유지한다.
 *
 * 이름은 완전일치로만 합친다. 운영 현황의 "디노랩스_김진태"처럼 표기가 다르면 별개 강사로
 * 남는데, 자동 정규화는 동명이인(예: 노션의 김성재A/김성재B)을 합쳐버릴 위험이 있어 하지 않는다.
 */
export function mergeNotionInstructors(
  entries: InstructorWikiEntry[],
  notionNames: string[]
): InstructorWikiEntry[] {
  const seen = new Set(entries.map((entry) => entry.name.trim()));
  const merged = [...entries];

  for (const rawName of notionNames) {
    const name = rawName.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    merged.push({ id: name, name, companies: [], courseCount: 0, courses: [], coach: null, categories: [] });
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// 노션 카테고리를 강사명 완전일치로 붙인다(coach-db 보강과 같은 방식).
export function attachNotionCategories(
  entries: InstructorWikiEntry[],
  categoriesByName: Record<string, string[]>
): void {
  for (const entry of entries) {
    const categories = categoriesByName[entry.name.trim()];
    if (categories && categories.length > 0) {
      entry.categories = categories;
    }
  }
}

export const NO_CATEGORY_LABEL = "카테고리 미지정";

export interface InstructorCategoryGroup {
  label: string;
  entries: InstructorWikiEntry[];
}

/**
 * 카테고리별로 묶는다. 노션 카테고리는 multi_select라 한 강사가 여러 카테고리에 속할 수 있고,
 * 그 경우 각 그룹에 모두 들어간다(합계가 전체 인원보다 클 수 있음).
 * 카테고리가 없는 강사는 "카테고리 미지정"으로 맨 뒤에 모은다.
 */
export function groupEntriesByCategory(entries: InstructorWikiEntry[]): InstructorCategoryGroup[] {
  const byCategory = new Map<string, InstructorWikiEntry[]>();
  const noCategory: InstructorWikiEntry[] = [];

  for (const entry of entries) {
    if (entry.categories.length === 0) {
      noCategory.push(entry);
      continue;
    }
    for (const category of entry.categories) {
      const bucket = byCategory.get(category);
      if (bucket) bucket.push(entry);
      else byCategory.set(category, [entry]);
    }
  }

  // 인원 많은 카테고리를 먼저 보여준다(같으면 이름순). 미지정은 항상 마지막.
  const groups = Array.from(byCategory.entries())
    .map(([label, groupEntries]) => ({ label, entries: groupEntries }))
    .sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label, "ko"));

  if (noCategory.length > 0) {
    groups.push({ label: NO_CATEGORY_LABEL, entries: noCategory });
  }

  return groups;
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
