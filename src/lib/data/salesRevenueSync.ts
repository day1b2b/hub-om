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
  multiCourseIds: string[];
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

export async function runSalesRevenueSync({
  apply,
  actorEmail
}: {
  apply: boolean;
  actorEmail: string;
}): Promise<SalesRevenueSyncResult> {
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
  // hub-om 코스ID에 눈에 안 보이는 문자(제로폭 공백 등)나 공백이 섞여 매칭이 안 되는 경우가 있어,
  // 양쪽 코스ID를 정규화(보이지 않는 문자 제거 + trim)한 뒤 맞춘다.
  const normalizedRecordIds = new Set(records.map((record) => normalizeCourseId(record.courseId)));
  const courses: CourseRow[] = await prisma.course.findMany({
    where: { courseId: { not: "" } },
    select: { id: true, courseId: true, name: true, revenue: true, company: { select: { name: true } } }
  });

  const coursesByCourseId = new Map<string, CourseRow[]>();
  for (const course of courses) {
    const normalized = normalizeCourseId(course.courseId);
    if (!normalized || !normalizedRecordIds.has(normalized)) continue;
    const list = coursesByCourseId.get(normalized) ?? [];
    list.push(course);
    coursesByCourseId.set(normalized, list);
  }

  const changes: SalesRevenueChange[] = [];
  const unmatchedCourseIds: string[] = [];
  const multiCourseIds: string[] = [];
  let matchedCourseIds = 0;
  let filled = 0;
  let changed = 0;
  let unchanged = 0;
  const pendingUpdates: Array<{ id: string; revenue: number }> = [];

  for (const record of records) {
    const matched = coursesByCourseId.get(normalizeCourseId(record.courseId));
    if (!matched || matched.length === 0) {
      unmatchedCourseIds.push(record.courseId);
      continue;
    }
    matchedCourseIds += 1;

    // 같은 코스ID가 여러 과정 행에 걸리면 과정별로 모두 채운다(화면 표시용).
    // 총 매출 합계는 대시보드에서 코스ID당 1번만 집계하므로 중복 집계되지 않는다.
    if (matched.length > 1) {
      multiCourseIds.push(record.courseId);
    }

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
        pendingUpdates.push({ id: course.id, revenue: after });
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

  // 일부만 읽은(partial) 상태에서는 값이 부분 합산일 수 있으므로 실제 쓰기를 막는다.
  const blockedByPartial = apply && read.status === "partial";
  const issues = read.issues.map((issue) => issue.message);
  let updatedRows = 0;

  if (apply && !blockedByPartial && pendingUpdates.length > 0) {
    // 전부 성공 아니면 전부 취소(중간 실패 시 절반만 써지는 것 방지).
    // 첫 대량 반영(수백 건)에서도 기본 시간제한에 걸리지 않도록 인터랙티브 트랜잭션 + 넉넉한 timeout.
    await prisma.$transaction(
      async (tx) => {
        for (const update of pendingUpdates) {
          await tx.course.update({
            where: { id: update.id },
            data: { revenue: update.revenue, revenueRaw: String(update.revenue) }
          });
        }
      },
      { timeout: 120_000, maxWait: 10_000 }
    );
    updatedRows = pendingUpdates.length;
  }

  if (blockedByPartial) {
    issues.push("세일즈맵 딜을 일부만 읽어(partial) 반영을 막았습니다. SALESMAP_MAX_PAGES를 올린 뒤 다시 시도하세요.");
  }

  const result: SalesRevenueSyncResult = {
    configured: true,
    readStatus: read.status,
    readCount: records.length,
    matchedCourseIds,
    filled,
    changed,
    unchanged,
    updatedRows,
    unmatchedCourseIds,
    multiCourseIds,
    applied: apply && !blockedByPartial,
    changes,
    issues
  };

  // 감사 로그: 실제 반영 시도(POST)만 기록한다. 로그 실패가 동기화를 막지 않도록 격리한다.
  if (apply) {
    try {
      await prisma.salesRevenueSyncLog.create({
        data: {
          status: result.readStatus,
          applied: result.applied,
          readCount: result.readCount,
          matched: result.matchedCourseIds,
          filled: result.filled,
          changed: result.changed,
          unchanged: result.unchanged,
          updatedRows: result.updatedRows,
          unmatched: result.unmatchedCourseIds.length,
          ambiguous: result.multiCourseIds.length,
          triggeredBy: actorEmail,
          detail: {
            unmatchedCourseIds: result.unmatchedCourseIds.slice(0, 500),
            multiCourseIds: result.multiCourseIds.slice(0, 500),
            issues: result.issues
          }
        }
      });
    } catch {
      // 감사 로그 기록 실패는 무시(동기화 결과에 영향 주지 않음).
    }
  }

  return result;
}

/** 코스ID 비교용 정규화: 제로폭 공백 등 보이지 않는 문자를 제거하고 앞뒤 공백을 없앤다. */
function normalizeCourseId(value: string): string {
  return value.replace(/[​-‍﻿ ]/g, "").trim();
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
    multiCourseIds: [],
    applied: false,
    changes: [],
    issues
  };
}
