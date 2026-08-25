import type { InstructorNote } from "@/lib/data/instructorNoteRepository";
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
  /**
   * 노션 강사 DB의 ID("NO"). 노션↔사이트 연결 키이며 상세 주소로도 쓴다.
   * 운영 현황에만 있는 표기(노션에 없는 강사)는 undefined다.
   */
  notionNo?: number;
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
 * OM이 수동 연결한 노션 강사로 항목을 합친다.
 *
 * 운영 현황은 강사 식별자 없이 이름 텍스트만 갖고 있어서, `디노랩스_김진태`처럼 표기가 다르면
 * 노션의 `김진태`와 별개 사람으로 갈린다. 노션 NO를 키로 쓰게 된 뒤에도 이 문제는 남는다.
 * 운영 현황 쪽에 NO가 없기 때문이다. 그래서 OM이 상세 화면에서 지정한 연결을 그대로 쓴다.
 *
 * linkTargets: 운영 현황 표기 → 노션 강사명. 연결된 항목의 코스 이력을 노션 강사명 항목으로 옮긴다.
 */
export function applyNotionLinks(
  entries: InstructorWikiEntry[],
  linkTargets: Record<string, string>
): InstructorWikiEntry[] {
  if (Object.keys(linkTargets).length === 0) return entries;

  const byName = new Map<string, InstructorWikiEntry>();
  for (const entry of entries) byName.set(entry.name, entry);

  const removed = new Set<string>();

  for (const entry of entries) {
    const target = linkTargets[entry.name];
    if (!target || target === entry.name) continue;

    let host = byName.get(target);
    if (!host) {
      // 노션 강사 항목이 아직 목록에 없으면(동기화 전 등) 빈 항목을 만들어 이력을 붙인다.
      host = { id: target, name: target, companies: [], courseCount: 0, courses: [], coach: null, categories: [] };
      byName.set(target, host);
    }
    host.courses.push(...entry.courses);
    removed.add(entry.name);
  }

  const merged = [...byName.values()].filter((entry) => !removed.has(entry.name));
  for (const entry of merged) {
    entry.courses.sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
    entry.companies = Array.from(new Set(entry.courses.map((course) => course.companyName).filter(Boolean)));
    entry.courseCount = entry.courses.length;
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/**
 * 강사 명단의 기준을 노션 강사 DB로 넓힌다.
 *
 * 강사 정보(소속·카테고리·강사료)는 노션에서 오고, 담당 코스·과정은 운영 현황에서 온다.
 * 그래서 운영 현황 기반 entry는 그대로 두고(코스 이력 보존) 노션 NO·카테고리만 붙이며,
 * 운영에 없는 노션 강사는 코스가 빈 entry로 추가한다.
 *
 * 이름이 같은 노션 강사가 둘 이상이면(동명이인, 예: 김준범 NO=185 / NO=746) 운영 현황의
 * 그 이름이 누구인지 알 수 없다. 이때는 추측하지 않고 운영 entry를 그대로 두고 노션 쪽을
 * 각각 별도 entry로 세운다. 목록에 셋이 보이면서 정리가 필요한 상태가 드러난다.
 */
export function mergeNotionNotes(entries: InstructorWikiEntry[], notes: InstructorNote[]): InstructorWikiEntry[] {
  const notionNotes = notes.filter((note) => note.notionNo !== undefined && note.instructorName);

  // 이름이 몇 번 쓰였는지 세어 동명이인을 가려낸다.
  const nameUseCount = new Map<string, number>();
  for (const note of notionNotes) {
    const name = (note.instructorName ?? "").trim();
    nameUseCount.set(name, (nameUseCount.get(name) ?? 0) + 1);
  }

  const merged = [...entries];
  const byName = new Map<string, InstructorWikiEntry[]>();
  for (const entry of merged) {
    const list = byName.get(entry.name) ?? [];
    list.push(entry);
    byName.set(entry.name, list);
  }

  for (const note of notionNotes) {
    const name = (note.instructorName ?? "").trim();
    const notionNo = note.notionNo as number;
    const categories = note.notion?.categories ?? [];

    // 이름이 유일하고, 그 이름의 운영 entry가 딱 하나이고, 아직 NO가 안 붙었으면 그 entry에 붙인다.
    const candidates = (byName.get(name) ?? []).filter((entry) => entry.notionNo === undefined);
    if (nameUseCount.get(name) === 1 && candidates.length === 1) {
      candidates[0].notionNo = notionNo;
      if (categories.length > 0) candidates[0].categories = categories;
      continue;
    }

    merged.push({
      id: `no-${notionNo}`,
      name,
      companies: [],
      courseCount: 0,
      courses: [],
      coach: null,
      categories,
      notionNo
    });
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/**
 * 상세 화면 주소. 노션 NO가 있으면 NO로 간다(동명이인까지 구분됨).
 * 노션에 없는 강사(운영 현황 표기만 있는 경우)는 이름으로 갈 수밖에 없다.
 */
export function instructorWikiHref(entry: Pick<InstructorWikiEntry, "name" | "notionNo">): string {
  return entry.notionNo !== undefined
    ? `/instructor-wiki/${entry.notionNo}`
    : `/instructor-wiki/${encodeURIComponent(entry.name)}`;
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
