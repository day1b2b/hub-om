import { getPrismaClient } from "@/lib/data/prisma";
import { hasSalesmapConfig, SalesmapSourceReader } from "@/lib/sourceReads/salesmapSourceReader";

/**
 * 세일즈맵 매출을 hub-om `courses.revenue`에 반영한다.
 * 매칭 열쇠는 코스ID(`courses.course_id`)이고, 세일즈맵 `금액`으로 매출 칸을 덮어쓴다.
 * 관리자 sync 페이지의 "미리보기 → 반영" 흐름을 위해 apply 플래그로 조회/쓰기를 나눈다.
 * 실제 쓰기 권한은 호출하는 API 라우트(assertAdminSession)에서 강제한다.
 */

export interface SalesRevenueChange {
  courseId: string;
  companyName?: string;
  courseName?: string;
  before: number | null;
  after: number;
  action: "fill" | "change" | "same";
}

export interface SalesRevenueSyncResult {
  configured: boolean;
  readStatus: string;
  readCount: number;
  matchedCourseIds: number;
  filled: number;
  changed: number;
  unchanged: number;
  updatedRows: number;
  unmatchedCourseIds: string[];
  applied: boolean;
  changes: SalesRevenueChange[];
  issues: string[];
}

interface CourseRow {
  id: string;
  courseId: string;
  name: string;
  revenue: unknown;
  company: { name: string } | null;
}

export async function runSalesRevenueSync({ apply }: { apply: boolean }): Promise<SalesRevenueSyncResult> {
  if (!hasSalesmapConfig()) {
    return emptyResult("disabled", ["세일즈맵 토큰(SALESMAP_API_TOKEN)이 설정되지 않았습니다."], false);
  }

  const read = await new SalesmapSourceReader().readSalesRecords();
  const records = read.items.filter(
    (record): record is typeof record & { courseId: string; revenue: number } =>
      Boolean(record.courseId) && record.revenue != null
  );

  if (read.status === "failed") {
    return emptyResult(read.status, read.issues.map((issue) => issue.message), true);
  }

  const prisma = getPrismaClient();
  const courseIds = [...new Set(records.map((record) => record.courseId))];
  const courses: CourseRow[] = courseIds.length
    ? await prisma.course.findMany({
        where: { courseId: { in: courseIds } },
        select: { id: true, courseId: true, name: true, revenue: true, company: { select: { name: true } } }
      })
    : [];

  const coursesByCourseId = new Map<string, CourseRow[]>();
  for (const course of courses) {
    const list = coursesByCourseId.get(course.courseId) ?? [];
    list.push(course);
    coursesByCourseId.set(course.courseId, list);
  }

  const changes: SalesRevenueChange[] = [];
  const unmatchedCourseIds: string[] = [];
  let matchedCourseIds = 0;
  let filled = 0;
  let changed = 0;
  let unchanged = 0;
  let updatedRows = 0;

  for (const record of records) {
    const matched = coursesByCourseId.get(record.courseId);
    if (!matched || matched.length === 0) {
      unmatchedCourseIds.push(record.courseId);
      continue;
    }
    matchedCourseIds += 1;

    for (const course of matched) {
      const before = toNumber(course.revenue);
      const after = record.revenue;
      const action: SalesRevenueChange["action"] =
        before === null ? "fill" : before !== after ? "change" : "same";

      if (action === "same") {
        unchanged += 1;
      } else {
        if (action === "fill") filled += 1;
        else changed += 1;

        if (apply) {
          await prisma.course.update({
            where: { id: course.id },
            data: { revenue: after, revenueRaw: String(after) }
          });
          updatedRows += 1;
        }
      }

      changes.push({
        courseId: record.courseId,
        companyName: course.company?.name,
        courseName: course.name,
        before,
        after,
        action
      });
    }
  }

  return {
    configured: true,
    readStatus: read.status,
    readCount: records.length,
    matchedCourseIds,
    filled,
    changed,
    unchanged,
    updatedRows,
    unmatchedCourseIds,
    applied: apply,
    changes,
    issues: read.issues.map((issue) => issue.message)
  };
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyResult(readStatus: string, issues: string[], configured: boolean): SalesRevenueSyncResult {
  return {
    configured,
    readStatus,
    readCount: 0,
    matchedCourseIds: 0,
    filled: 0,
    changed: 0,
    unchanged: 0,
    updatedRows: 0,
    unmatchedCourseIds: [],
    applied: false,
    changes: [],
    issues
  };
}
